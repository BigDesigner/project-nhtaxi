import { driverProfilesTable, usersTable } from "@gnncab/db";

/** Column selection shared by driver self-view (routes/driver_profile.ts)
 * and admin driver listing/detail (routes/admin.ts) — both join the same
 * two tables into the same response shape. */
export function driverProfileWithUserColumns() {
  return {
    id: driverProfilesTable.id,
    userId: driverProfilesTable.userId,
    email: usersTable.email,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    phone: usersTable.phone,
    licenseNumber: driverProfilesTable.licenseNumber,
    vehicleMake: driverProfilesTable.vehicleMake,
    vehicleModel: driverProfilesTable.vehicleModel,
    vehicleYear: driverProfilesTable.vehicleYear,
    vehicleColor: driverProfilesTable.vehicleColor,
    vehiclePlate: driverProfilesTable.vehiclePlate,
    status: driverProfilesTable.status,
    isVerified: driverProfilesTable.isVerified,
    cityId: driverProfilesTable.cityId,
    rating: driverProfilesTable.rating,
    totalTrips: driverProfilesTable.totalTrips,
  };
}
