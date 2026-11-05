# A small public-key setup like a commercial one, for the signature tests:
#   root CA -> intermediate CA -> the signer's certificate (in a password-protected .p12 with its chain)
#   root CA -> timestamp authority (extended key usage timeStamping)
# and two helpers: a timestamp server (RFC 3161, request on stdin, reply on stdout) and a validator built on pyHanko, an
# independent implementation of PAdES / ISO 32000 signature checking (trust chain, integrity, timestamp, modifications).
#   python3 pki.py make DIR | tsa DIR | validate DIR file.pdf
import datetime as dt, json, os, sys
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12

PW = b'pass1234'


def name(cn, o='Quire Test PKI'):
    return x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, 'PT'), x509.NameAttribute(NameOID.ORGANIZATION_NAME, o), x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def cert(subject, key, issuer, ikey, ca=False, eku=None, days=3650, start=None):
    now = start or dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
    b = (x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(key.public_key()).serial_number(x509.random_serial_number())
         .not_valid_before(now).not_valid_after(now + dt.timedelta(days=days))
         .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
         .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
         .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ikey.public_key()), critical=False))
    if ca: b = b.add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
    else: b = b.add_extension(x509.KeyUsage(True, True, False, False, False, False, False, False, False), critical=True)
    if eku: b = b.add_extension(x509.ExtendedKeyUsage(eku), critical=True)
    return b.sign(ikey, hashes.SHA256())


def make(d):
    os.makedirs(d, exist_ok=True); k = lambda: rsa.generate_private_key(public_exponent=65537, key_size=2048)
    rk, ik, sk, tk = k(), k(), k(), k()
    root = cert(name('Quire Test Root CA'), rk, name('Quire Test Root CA'), rk, ca=True)
    inter = cert(name('Quire Test Signing CA'), ik, root.subject, rk, ca=True)
    signer = cert(name('Maria Teste', 'Arquivo de Teste'), sk, inter.subject, ik, days=365)
    tsa = cert(name('Quire Test Timestamp Authority'), tk, root.subject, rk, eku=[ExtendedKeyUsageOID.TIME_STAMPING])
    pem = lambda c: c.public_bytes(serialization.Encoding.PEM)
    open(os.path.join(d, 'root.pem'), 'wb').write(pem(root))
    open(os.path.join(d, 'signer.p12'), 'wb').write(pkcs12.serialize_key_and_certificates(b'Maria Teste', sk, signer, [inter, root],
        serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(2048).key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(PW)))
    open(os.path.join(d, 'tsa.pem'), 'wb').write(pem(tsa))
    open(os.path.join(d, 'tsa.key'), 'wb').write(tk.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))


def tsa(d):
    from asn1crypto import tsp, x509 as ax, keys
    from pyhanko.sign.timestamps.dummy_client import DummyTimeStamper
    from pyhanko.keys import load_cert_from_pemder, load_private_key_from_pemder
    from pyhanko_certvalidator.registry import SimpleCertificateStore
    t = DummyTimeStamper(load_cert_from_pemder(os.path.join(d, 'tsa.pem')), load_private_key_from_pemder(os.path.join(d, 'tsa.key'), None),
                         certs_to_embed=SimpleCertificateStore.from_certs([load_cert_from_pemder(os.path.join(d, 'root.pem'))]))
    sys.stdout.buffer.write(t.request_tsa_response(tsp.TimeStampReq.load(sys.stdin.buffer.read())).dump())


def validate(d, f):
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko.keys import load_cert_from_pemder
    from pyhanko_certvalidator import ValidationContext
    out = []
    with open(f, 'rb') as fh:
        r = PdfFileReader(fh)
        for sig in r.embedded_signatures:
            vc = ValidationContext(trust_roots=[load_cert_from_pemder(os.path.join(d, 'root.pem'))], allow_fetching=False, revocation_mode='soft-fail')
            st = validate_pdf_signature(sig, vc)
            ts = st.timestamp_validity
            out.append({'field': sig.field_name, 'intact': st.intact, 'valid': st.valid, 'trusted': st.trusted, 'bottom_line': st.bottom_line,
                        'signer': st.signing_cert.subject.native.get('common_name'), 'chain': [c.subject.native.get('common_name') for c in (st.validation_path or [])],
                        'coverage': st.coverage.name, 'modification_level': st.modification_level.name if st.modification_level else None,
                        'timestamp': ts and {'intact': ts.intact, 'valid': ts.valid, 'trusted': ts.trusted, 'time': ts.timestamp.isoformat()}})
    print(json.dumps(out))


if __name__ == '__main__':
    {'make': lambda: make(sys.argv[2]), 'tsa': lambda: tsa(sys.argv[2]), 'validate': lambda: validate(sys.argv[2], sys.argv[3])}[sys.argv[1]]()
