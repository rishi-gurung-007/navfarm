import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * The rules a silo's feed levels must satisfy, in one place so every screen
 * that edits them applies exactly the same ones.
 *
 * Extracted from LocationService when D41 let Feed Planning edit the levels
 * too: two screens writing the same three columns must not be able to disagree
 * about what is valid, and a second copy of these four lines would eventually
 * drift from the first.
 *
 * `required` is the create/silo-form case, where a silo may not exist without
 * both levels (D22). An edit that sends only one of them is checked against
 * whatever the row already holds, so the pair is still judged together.
 */
export function assertSiloLevels(
  lowKg: number | null | undefined,
  highKg: number | null | undefined,
  capacityKg: number | null,
  required = false,
): void {
  if (required && (lowKg == null || highKg == null)) {
    throw new BadRequestException('A silo needs both a Below Feed Level and an Above Threshold.');
  }
  if (lowKg != null && highKg != null && lowKg >= highKg) {
    throw new ConflictException('The low feed level must be below the high feed level.');
  }
  if (capacityKg != null) {
    if (highKg != null && highKg > capacityKg) throw new ConflictException('The high feed level cannot exceed the silo capacity.');
    if (lowKg != null && lowKg > capacityKg) throw new ConflictException('The low feed level cannot exceed the silo capacity.');
  }
}
