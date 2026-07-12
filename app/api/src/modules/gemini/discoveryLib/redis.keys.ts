export const redisKeys = {
    circuitBreaker: (name: string) => `discovery:cb:${name}`,
    checkpoint: (campaignId: string) => `discovery:checkpoint:${campaignId}`,
    cancel: (campaignId: string) => `discovery:cancel:${campaignId}`,
    titleInference: (hash: string) => `discovery:titles:${hash}`,
    atsIngredients: (hash: string) => `discovery:ats-ingredients:${hash}`,
    builtWith: (domain: string) => `discovery:builtwith:${domain}`,
} as const;