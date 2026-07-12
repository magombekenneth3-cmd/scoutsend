import { Router } from "express";
import { handleCalendlyCallback } from "./calendar.controller";

const router = Router();

router.get("/callback", handleCalendlyCallback);

export default router;