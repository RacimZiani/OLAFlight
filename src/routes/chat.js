import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { chatBodySchema } from "../schemas/index.js";
import { runAgent } from "../lib/agentRunner.js";
import { config } from "../config.js";
import { HttpError } from "../middleware/errorHandler.js";

const router = Router();

router.post("/", validate({ body: chatBodySchema }), async (req, res, next) => {
  if (!config.anthropic.apiKey) {
    return next(
      new HttpError(500, "Missing ANTHROPIC_API_KEY. Create a .env file from .env.example and set your key.")
    );
  }
  try {
    const { messages, lang } = req.body;
    const result = await runAgent({ messages, lang });
    res.json({ response: result.text, lead: result.lead });
  } catch (err) {
    next(err);
  }
});

export default router;
