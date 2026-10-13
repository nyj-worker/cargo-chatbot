// Vercel Serverless Function 엔트리포인트
// server.js의 Express 앱 인스턴스를 직접 위임하여 서빙합니다.
const app = require('../server.js');

module.exports = app;
