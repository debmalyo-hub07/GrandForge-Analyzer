import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { requireAuth, type AuthRequest } from '../../auth';
import User from '../../models/User';

const app = createApp();

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    await connectDB();

    const user = await User.findById(req.userId).select('-passwordHash').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json({ user });
  } catch (err) {
    console.error('GrandForge /me error:', err);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default app;
