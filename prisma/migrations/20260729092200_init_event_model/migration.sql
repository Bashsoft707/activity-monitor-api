-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('USER_SIGNUP', 'PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'LOGIN_FAILED', 'ORDER_SHIPPED', 'SUBSCRIPTION_EXPIRING');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'WHATSAPP');

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "type" "EventType" NOT NULL,
    "label" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_created_at_idx" ON "events"("created_at");
