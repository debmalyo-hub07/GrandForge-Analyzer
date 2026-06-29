import { z } from 'zod';
import { createApp } from '../../createApp';
import { connectDB } from '../../db';
import { requireAuth, type AuthRequest } from '../../auth';
import User from '../../models/User';

const preferencesSchema = z.object({
  boardTheme: z.string().min(1).max(50).optional(),
  pieceSet: z.string().min(1).max(50).optional(),
  defaultEngine: z.enum(['sf18-lite', 'sf18-full', 'sf17-lite', 'sf16-lite']).optional(),
  defaultDepth: z.number().int().min(1).max(30).optional(),
  defaultMultiPV: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  showCoordinates: z.boolean().optional(),
  showLegalMoves: z.boolean().optional(),
  animationSpeed: z.enum(['fast', 'normal', 'slow']).optional(),
  inlineNotation: z.boolean().optional(),
  disclosureButtons: z.boolean().optional(),
  moveAnnotations: z.boolean().optional(),
  variationOpacity: z.number().min(0).max(100).optional(),
}).strict();

const app = createApp();

app.put('/api/auth/preferences', requireAuth, async (req: AuthRequest, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid preferences', issues: parsed.error.flatten() });
  }

  try {
    await connectDB();

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) update[`preferences.${key}`] = value;
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: update },
      { new: true, runValidators: true }
    ).select('preferences').lean();

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json({ preferences: user.preferences });
  } catch (err) {
    console.error('GrandForge preferences update error:', err);
    return res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default app;
