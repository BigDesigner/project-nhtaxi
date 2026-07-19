import { z } from "@hono/zod-openapi";
import { CLIENT_PLATFORMS } from "./auth";

export const DRIVER_STATUSES = ["AVAILABLE", "RESERVED", "BUSY", "OFFLINE"] as const;
export const DRIVER_SELF_SETTABLE_STATUSES = ["AVAILABLE", "OFFLINE"] as const;
export const DRIVER_DOCUMENT_TYPES = ["license", "background_check", "photo"] as const;
export const DRIVER_DOCUMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

// L15 — driver self sign-up. `acceptedAgreement` must be explicitly true;
// there is no implicit consent.
export const DriverRegisterRequestSchema = z
  .object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email(),
    phone: z.string().min(7).max(20),
    password: z.string().min(8).max(200),
    vehicleMake: z.string().max(100).optional(),
    vehicleModel: z.string().max(100).optional(),
    vehicleYear: z.number().int().min(1980).max(2100).optional(),
    vehicleColor: z.string().max(50).optional(),
    vehiclePlate: z.string().max(20).optional(),
    licenseNumber: z.string().max(50).optional(),
    acceptedAgreement: z.literal(true),
    deviceInfo: z.string().max(200).optional(),
    platform: z.enum(CLIENT_PLATFORMS).default("web"),
  })
  .openapi("DriverRegisterRequest");

export const DriverProfileResponseSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string().nullable(),
    licenseNumber: z.string().nullable(),
    vehicleMake: z.string().nullable(),
    vehicleModel: z.string().nullable(),
    vehicleYear: z.number().int().nullable(),
    vehicleColor: z.string().nullable(),
    vehiclePlate: z.string().nullable(),
    status: z.enum(DRIVER_STATUSES),
    isVerified: z.boolean(),
    cityId: z.string().nullable(),
    rating: z.number().nullable(),
    totalTrips: z.number().int(),
  })
  .openapi("DriverProfileResponse");

// A driver may only move themselves between AVAILABLE/OFFLINE — BUSY and
// RESERVED are dispatch-controlled (Faz 3), never client-settable.
export const DriverProfileUpdateRequestSchema = z
  .object({
    vehicleMake: z.string().max(100).optional(),
    vehicleModel: z.string().max(100).optional(),
    vehicleYear: z.number().int().min(1980).max(2100).optional(),
    vehicleColor: z.string().max(50).optional(),
    vehiclePlate: z.string().max(20).optional(),
    licenseNumber: z.string().max(50).optional(),
    status: z.enum(DRIVER_SELF_SETTABLE_STATUSES).optional(),
  })
  .openapi("DriverProfileUpdateRequest");

export const DriverDocumentSchema = z
  .object({
    id: z.string(),
    type: z.enum(DRIVER_DOCUMENT_TYPES),
    status: z.enum(DRIVER_DOCUMENT_STATUSES),
    uploadedAt: z.string(),
    reviewedAt: z.string().nullable(),
  })
  .openapi("DriverDocument");
