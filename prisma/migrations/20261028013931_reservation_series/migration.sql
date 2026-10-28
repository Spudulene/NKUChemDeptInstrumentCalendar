-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "seriesId" TEXT;

-- CreateTable
CREATE TABLE "ReservationSeries" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "daysOfWeek" "Weekday"[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "firstDate" DATE NOT NULL,
    "lastDate" DATE NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReservationSeries_userId_idx" ON "ReservationSeries"("userId");

-- CreateIndex
CREATE INDEX "ReservationSeries_instrumentId_idx" ON "ReservationSeries"("instrumentId");

-- CreateIndex
CREATE INDEX "Booking_seriesId_idx" ON "Booking"("seriesId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ReservationSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationSeries" ADD CONSTRAINT "ReservationSeries_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationSeries" ADD CONSTRAINT "ReservationSeries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
