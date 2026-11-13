import { Module } from '@nestjs/common';
import { AnimalBookValueService } from './animal-book-value.service';

/** The ledger-derived book value of an animal; stateless, so any module that needs it imports this one. */
@Module({ providers: [AnimalBookValueService], exports: [AnimalBookValueService] })
export class AnimalBookValueModule {}
