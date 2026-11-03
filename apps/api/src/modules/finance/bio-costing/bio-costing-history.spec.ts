import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { runsOfItem, runsSharingAnimalsWith } from './bio-costing-history';

describe('runsOfItem — the runs that are an item\'s history', () => {
  const rendered = () => new MySqlDialect().sqlToQuery(runsOfItem('item-1'));

  it('takes the runs made for the item', () => {
    expect(rendered().sql).toContain('`bio_costing_run`.`item_id` = ?');
  });

  it('and the runs a profile made that touched one of the item\'s animals, read through their lines, without changing them', () => {
    const { sql, params } = rendered();
    expect(sql).toMatch(/`bio_costing_run`\.`run_id` IN \(SELECT l\.run_id FROM `bio_costing_run_line` l JOIN `animal_register` a ON a\.animal_id = l\.animal_id WHERE a\.item_id = \?\)/);
    expect(params).toEqual(['item-1', 'item-1']);
  });
});

describe('runsSharingAnimalsWith — the history of a run that names no item', () => {
  it('is every run that has a line for an animal this run has a line for', () => {
    const { sql, params } = new MySqlDialect().sqlToQuery(runsSharingAnimalsWith('run-1'));
    expect(sql).toMatch(/`bio_costing_run`\.`run_id` IN \(SELECT l2\.run_id FROM `bio_costing_run_line` l2 WHERE l2\.animal_id IN \(SELECT l1\.animal_id FROM `bio_costing_run_line` l1 WHERE l1\.run_id = \?\)\)/);
    expect(params).toEqual(['run-1']);
  });
});
