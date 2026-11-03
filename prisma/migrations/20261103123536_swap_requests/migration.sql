-- CreateEnum
CREATE TYPE "SwapRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateTable
CREATE TABLE "SwapRequest" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "advisorId" TEXT,
    "note" TEXT,
    "status" "SwapRequestStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "holderNotifiedAt" TIMESTAMP(3),
    "requesterNotifiedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "resultBookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SwapRequest_tokenHash_key" ON "SwapRequest"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "SwapRequest_resultBookingId_key" ON "SwapRequest"("resultBookingId");

-- CreateIndex
CREATE INDEX "SwapRequest_bookingId_status_idx" ON "SwapRequest"("bookingId", "status");

-- CreateIndex
CREATE INDEX "SwapRequest_requesterId_status_idx" ON "SwapRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "SwapRequest_status_requesterNotifiedAt_idx" ON "SwapRequest"("status", "requesterNotifiedAt");

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_resultBookingId_fkey" FOREIGN KEY ("resultBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One open request per requester per booking. Partial, so asking again after a
-- decline or a withdrawal is still possible. Prisma's schema DSL can't express this.
CREATE UNIQUE INDEX "SwapRequest_one_pending_per_requester"
  ON "SwapRequest"("bookingId", "requesterId")
  WHERE "status" = 'PENDING';
