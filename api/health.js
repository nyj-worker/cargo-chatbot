module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
        status: 'ok',
        platform: 'Vercel Serverless',
        service: '남양주시 화물팀 인허가 안내 챗봇',
        hasGroqKey: Boolean(process.env.GROQ_API_KEY),
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
    });
};
