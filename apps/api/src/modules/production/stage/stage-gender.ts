import { BadRequestException } from '@nestjs/common';

/**
 * A stage may be configured for one sex (stage_master.applicable_gender, F or M); NULL means either.
 * Nothing in the platform decides which stages those are — the client sets them — so an unconfigured
 * stage admits everyone, exactly as before the setting existed.
 */
export function stageFitsGender(stage: { applicable_gender?: string | null }, gender: string | null | undefined): boolean {
  return !stage.applicable_gender || !gender || stage.applicable_gender === gender;
}

export function assertStageFitsAnimal(
  stage: { applicable_gender?: string | null; stage_name?: string | null },
  animal: { gender?: string | null; animal_code?: string | null },
): void {
  if (stageFitsGender(stage, animal.gender)) return;
  const wants = stage.applicable_gender === 'F' ? 'female' : 'male';
  throw new BadRequestException(
    `Stage '${stage.stage_name ?? 'selected'}' is for ${wants} animals only; ${animal.animal_code ?? 'this animal'} is ${animal.gender === 'F' ? 'female' : 'male'}.`,
  );
}
