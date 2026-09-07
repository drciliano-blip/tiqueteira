/**
 * Validação de ambiente. Falha na inicialização, não em produção às 2h da manhã.
 * Só para servidor — nunca importe isto de um componente de cliente.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  DIRECT_URL: z.string().min(1).optional(),
  SERVICE_DATABASE_URL: z.string().min(1).optional(),

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET precisa de pelo menos 32 caracteres'),
  NEXT_PUBLIC_APP_URL: z.url(),

  PAYMENT_PROVIDER: z.string().default('fake'),
  PAYMENT_API_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  PAYMENT_OPERATOR_RECIPIENT_ID: z.string().optional(),

  TICKET_HMAC_SECRET: z.string().min(32, 'TICKET_HMAC_SECRET precisa de pelo menos 32 caracteres'),
  TICKET_HMAC_SECRET_PREVIOUS: z.string().optional(),

  JOB_SECRET: z.string().min(16),

  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

let cached: z.infer<typeof schema> | null = null;

export function env(): z.infer<typeof schema> {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detalhes = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Ambiente inválido:\n${detalhes}`);
  }

  // Regra do plano, seção 15: o provider falso não pode chegar em produção.
  if (parsed.data.NODE_ENV === 'production' && parsed.data.PAYMENT_PROVIDER === 'fake') {
    throw new Error(
      'PAYMENT_PROVIDER=fake é proibido em produção. ' +
        'Configure a PSP real antes de subir.',
    );
  }

  cached = parsed.data;
  return cached;
}
