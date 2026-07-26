import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { signToken } from '../../auth';
import User from '../../models/User';

const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

const app = createApp();

app.post('/api/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', issues: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  try {
    await connectDB();

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    user.stats.lastActiveAt = new Date();
    await user.save();

    const token = signToken({ userId: user._id.toString(), email: user.email });

    const userObj = user.toObject() as unknown as Record<string, unknown>;
    delete userObj.passwordHash;

    return res.status(200).json({ user: userObj, token });
  } catch (err) {
    console.error('GrandForge login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

export default app;
