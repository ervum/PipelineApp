-- Phase 2: Media Post-Processing Quality
ALTER TYPE "AssetFileRole" ADD VALUE IF NOT EXISTS 'LOD1';
ALTER TYPE "AssetFileRole" ADD VALUE IF NOT EXISTS 'LOD2';
