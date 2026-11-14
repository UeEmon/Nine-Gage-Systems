import { z } from "zod";
import { PROVIDERS } from "./types";

export const AiSettingsSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(500).optional(),
});
