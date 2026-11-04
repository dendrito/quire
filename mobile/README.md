# Quire Lite for iPad and Android

The same Quire Lite as the desktop apps, wrapped with [Capacitor](https://capacitorjs.com). Everything runs on the
tablet: no internet needed after install. Saving a PDF opens the share sheet (Save to Files, AirDrop, Mail, Drive...).

## Android

Download **Quire-lite-android** from the latest "Build iPad and Android apps" run in the Actions tab, unzip it, copy
`Quire-Lite-Android.apk` to the tablet and open it. Android asks once to allow installing apps from that source.

## iPad (needs a Mac with Xcode)

1. In Terminal: `cd mobile && npm install && npm run ios` (this builds the app files and opens Xcode).
2. In Xcode, click **App** in the left column, then **Signing & Capabilities**, and choose your Apple ID under Team
   (add it in Xcode > Settings > Accounts if it is not there; a free Apple ID works).
3. Plug in the iPad, pick it at the top of the window, and press ▶ Run.
4. The first time, on the iPad: Settings > General > VPN & Device Management > trust your Apple ID.

With a free Apple ID the app runs for 7 days, then needs another Run from Xcode. A paid Apple Developer account
(99 USD a year) removes that limit and allows TestFlight.

## Changing the app

The app is built from `web/quire-pdf-studio.html` by `scripts/build-www.js` (Lite edition). `scripts/native.js` connects
saving to the share sheet. Icons come from `branding/`.
