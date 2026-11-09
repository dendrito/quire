"""Converts kraken models (CoreML .mlmodel or safetensors) to ONNX so Quire can run them in the browser with
onnxruntime-web, and writes a small JSON file next to each with what the app needs: input height and channels,
the character table (codec) for a reader, and the class map for the line finder.

    python convert.py MODEL OUT_PREFIX [--name "Shown name"] [--source URL] [--licence CC-BY-4.0]

A reader (recognition model) becomes OUT_PREFIX.onnx taking an inverted greyscale line image (1, C, H, W), ink = 1,
and giving per-column character probabilities (1, classes, W'). The line finder (baseline segmentation) gives the
raw heat map (1, classes, H/4, W/4) before the sigmoid.
"""
import argparse, json, sys, warnings
import torch
warnings.filterwarnings('ignore')

ap = argparse.ArgumentParser()
ap.add_argument('model'); ap.add_argument('out'); ap.add_argument('--name', default=''); ap.add_argument('--source', default='')
ap.add_argument('--licence', default=''); ap.add_argument('--about', default='')
a = ap.parse_args()

from kraken.lib.vgsl import TorchVGSLModel
try:
    from kraken.models import load_models
    m = next(x for x in load_models(a.model) if isinstance(x, TorchVGSLModel))
except Exception as e:
    print('load_models failed, falling back:', e, file=sys.stderr)
    m = TorchVGSLModel.load_model(a.model)
m.eval()
kind = 'segmentation' if 'segmentation' in m.model_type else 'recognition'
batch, channels, height, width = m.input
print(kind, m.spec, 'input', m.input, file=sys.stderr)


class Rec(torch.nn.Module):
    def __init__(s, n): super().__init__(); s.n = n
    def forward(s, x):
        o = s.n(x); o = o[0] if isinstance(o, tuple) else o
        return o.squeeze(2).softmax(1)


class Seg(torch.nn.Module):
    def __init__(s, n): super().__init__(); s.n = n
    def forward(s, x):
        o = s.n(x); return o[0] if isinstance(o, tuple) else o


meta = {'kind': kind, 'name': a.name, 'source': a.source, 'licence': a.licence, 'about': a.about, 'spec': m.spec,
        'height': height, 'channels': channels, 'one_channel_mode': m.one_channel_mode}
with torch.no_grad():
    if kind == 'recognition':
        x = torch.rand(1, channels, height, 400)
        w = Rec(m.nn).eval(); ref = w(x)
        torch.onnx.export(w, x, a.out + '.onnx', input_names=['line'], output_names=['probs'],
                          dynamic_axes={'line': {3: 'w'}, 'probs': {2: 'w2'}}, opset_version=17, dynamo=False)
        meta.update(pad=16, invert=True, c2l=m.codec.c2l, classes=int(ref.shape[1]),
                    scale=float(x.shape[3] / ref.shape[2]))
    else:
        h = height or 1800
        x = torch.rand(1, channels, h, 1200)
        w = Seg(m.nn).eval(); ref = w(x)
        torch.onnx.export(w, x, a.out + '.onnx', input_names=['image'], output_names=['heat'],
                          dynamic_axes={'image': {3: 'w'}, 'heat': {3: 'w2'}}, opset_version=17, dynamo=False)
        meta.update(height=h, invert=True, class_mapping=m.user_metadata.get('class_mapping'),
                    scale=float(x.shape[2] / ref.shape[2]))
    meta['accuracy'] = (m.user_metadata.get('accuracy') or [[0, 0]])[-1]

# check the ONNX file gives the same numbers as kraken
try:
    import onnxruntime as ort, numpy as np
    s = ort.InferenceSession(a.out + '.onnx'); got = s.run(None, {s.get_inputs()[0].name: x.numpy()})[0]
    r = ref.numpy()
    if kind != 'recognition': got, r = 1 / (1 + np.exp(-got)), 1 / (1 + np.exp(-r))  # compare what the app uses
    d = float(np.abs(got - r).max()); print('max difference vs kraken', d, file=sys.stderr); meta['onnx_check'] = d
    assert d < 2e-2, 'ONNX output differs from kraken'
except ImportError:
    print('onnxruntime not installed; skipped the check', file=sys.stderr)
json.dump(meta, open(a.out + '.json', 'w'), ensure_ascii=False)
print('wrote', a.out + '.onnx', a.out + '.json', file=sys.stderr)
