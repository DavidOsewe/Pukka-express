export default function handler(_req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'pukka-express-api',
    time: new Date().toISOString(),
  });
}
