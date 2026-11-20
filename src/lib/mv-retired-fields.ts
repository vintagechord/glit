/**
 * MV inputs the wizard no longer shows (포맷, 제작일, 사업자등록번호). Admin
 * direct intake and reference imports still fill them, so a save that does
 * not send a value keeps the stored one; only a value that is sent is written.
 */
export function retiredMvFieldUpdate(input: {
  format?: string;
  productionDate?: string;
  businessRegNo?: string;
}) {
  return {
    ...(input.format !== undefined ? { mv_format: input.format.trim() || null } : {}),
    ...(input.productionDate !== undefined ? { mv_production_date: input.productionDate.trim() || null } : {}),
    ...(input.businessRegNo !== undefined ? { mv_business_reg_no: input.businessRegNo.trim() || null } : {}),
  };
}
