const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Malformed token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = { id: payload.id, name: payload.name, role: payload.role || 'user' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
