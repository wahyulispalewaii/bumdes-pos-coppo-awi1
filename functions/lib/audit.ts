import type { Env } from './types';

interface AuditInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string;
  userAgent?: string;
}

export function auditStatement(env: Env, input: AuditInput): D1PreparedStatement {
  return env.DB.prepare(`
    INSERT INTO audit_logs (
      id, user_id, action, entity_type, entity_id, old_value_json, new_value_json, ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.userId || null,
    input.action,
    input.entityType,
    input.entityId || null,
    input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
    input.newValue === undefined ? null : JSON.stringify(input.newValue),
    input.ip || null,
    (input.userAgent || '').slice(0, 500) || null,
  );
}

export async function writeAudit(env: Env, input: AuditInput): Promise<void> {
  await auditStatement(env, input).run();
}
