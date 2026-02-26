export type BookingStatus = "booked" | "cancelled";

export type Booking = {
  id: string;
  classId: string;
  templateId?: string;
  userId: string;
  userName?: string;
  status: BookingStatus;
  createdAt?: any;      // Timestamp
  cancelledAt?: any;    // Timestamp
  attended?: boolean;
  checkedInAt?: any;    // Timestamp
  checkedInBy?: string; // uid of coach/admin
};