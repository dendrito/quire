# Building Quire

Every platform is built from the one web app, `web/quire-pdf-studio.html`, by one command:

```sh
node tools/build.js <platform> [lite|pro|both]
```

| platform  | makes                                                     | needs                                  |
|-----------|-----------------------------------------------------------|----------------------------------------|
| `web`     | `quire-lite.html`, `quire-pro.html` (open in a browser)    | Node 20 or later                       |
| `mac`     | `.dmg` for Apple silicon (arm64) and Intel (x64)           | a Mac                                  |
| `windows` | Setup and Portable `.exe`, x64 and arm64                   | Windows, or Linux with wine            |
| `android` | `Quire-Lite-Android.apk` (Lite only)                       | Java 17 and the Android SDK            |
| `ipad`    | checks the iPad app compiles (Lite only)                   | a Mac with Xcode                       |
| `all`     | every platform this computer can build                     |                                        |
| `check`   | lists what this computer can build and what is missing     |                                        |

The edition defaults to `both`. The files land in `build/<platform>/`, with `SHA256SUMS.txt` and
`source-commit.txt` (the commit they were built from). `--no-install` skips `npm install` when nothing changed.

## Without installing anything

GitHub runs the same command for each platform in `.github/workflows/build.yml`:

1. On GitHub, open **Actions > Build > Run workflow**.
2. When it finishes (about 20 minutes), open **Releases > Latest test build** and download the file for your computer.

A version tag such as `v1.3.0` builds everything and makes a release of its own. Pull requests build only the web pages
and Android, because Mac minutes count ten times.

The iPad app has to be installed from Xcode on a Mac, because iPads only run apps signed by Apple: see `mobile/README.md`.
