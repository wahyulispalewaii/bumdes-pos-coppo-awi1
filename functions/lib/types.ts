export interface Env {
  DB: D1Database;
  APP_NAME?: string;
  SESSION_TTL_HOURS?: string;
  SIMPLE_LOGIN_ENABLED?: string;
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
}

export interface AuthUser {
  id: string;
  organization_id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: 'ADMIN' | 'MANAGER' | 'FINANCE' | 'INVENTORY' | 'CASHIER' | 'VIEWER';
  default_outlet_id: string | null;
  must_change_password: number;
}

export interface RequestContext {
  env: Env;
  request: Request;
  user?: AuthUser;
  ip: string;
  userAgent: string;
}
