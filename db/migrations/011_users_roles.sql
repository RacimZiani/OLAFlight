-- Migration 011 : ajoute 'prospecteur' et 'closer' à l'enum user_role (Supabase/Postgres)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'prospecteur';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'closer';
