import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { signToken } from '../../auth';
import User from '../../models/User';

const registerSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  username: z.string().min(3).max(30).trim(),
  password: z.string().min(8).max(128),
});

const app = createApp();

app.post('/api/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', issues: parsed.error.flatten() });
  }
  const { email, username, password } = parsed.data;

  try {
    await connectDB();

    const existing = await User.findOne({ $or: [{ email }, { username }] }).lean();
    if (existing) {
      return res.status(409).json({ error: 'An account with these credentials already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      email,
      username,
      passwordHash,
    });

    const token = signToken({ userId: user._id.toString(), email: user.email });

    const userObj = user.toObject() as unknown as Record<string, unknown>;
    delete userObj.passwordHash;

    return res.status(201).json({ user: userObj, token });
  } catch (err) {
    console.error('GrandForge register error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

export default app;
