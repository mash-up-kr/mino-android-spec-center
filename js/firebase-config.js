/**
 * Firebase 웹 앱 config (공개값 — 커밋 OK).
 * enabled: true 이면 store-firebase.js 가 Firebase 백엔드를 쓴다.
 * false 면 store.js(mock, localStorage) 로 동작.
 */
window.MASC_FIREBASE = {
  enabled: true,
  config: {
    apiKey: 'AIzaSyAmWTE1TfbjB5QwL2avkuLIU9yUaWih8vc',
    authDomain: 'mino-spec-center.firebaseapp.com',
    projectId: 'mino-spec-center',
    storageBucket: 'mino-spec-center.firebasestorage.app',
    messagingSenderId: '233545139758',
    appId: '1:233545139758:web:2aa9f83b8a9202df5401bf',
  },
};
