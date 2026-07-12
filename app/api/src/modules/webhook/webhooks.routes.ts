import { Router } from "express";
import { handleInboundEmail } from "./inbound.controller";
import { handleProviderDeliveryEvent } from "./delivery.controller";
import { handleUnsubscribe, handleUnsubscribeOneClick, handleUnsubscribeConfirm } from "./unsubscribe.controller";
import { handleLinkedInWebhook } from "./linkedin.controller";
import { handleOpenTrackingPixel } from "./tracking.controller";

export const providerWebhookRouter = Router();
export const userWebhookRouter = Router();

providerWebhookRouter.post("/delivery-event", handleProviderDeliveryEvent);
providerWebhookRouter.get("/track/open/:token", handleOpenTrackingPixel);

userWebhookRouter.post("/inbound-email", handleInboundEmail);
userWebhookRouter.get("/unsubscribe/:token", handleUnsubscribe);
userWebhookRouter.post("/unsubscribe/:token/confirm", handleUnsubscribeConfirm);
userWebhookRouter.post("/unsubscribe/:token", handleUnsubscribeOneClick);
userWebhookRouter.post("/linkedin", handleLinkedInWebhook);