import { describe, expect, it } from 'vitest';
import { BUILD_MENU_SECTIONS, LATE_GAME_PREREQS, getDef } from '../src/data/buildings';

describe('late-game luxury chains', () => {
  it('flags the luxury buildings and wires their recipes', () => {
    expect(getDef('imkerei').lateGame).toBe(true);
    expect(getDef('methaus').lateGame).toBe(true);
    expect(getDef('goldschmiede').lateGame).toBe(true);
    expect(getDef('imkerei').recipe).toEqual({ output: 'honig', duration: 8 });
    expect(getDef('methaus').recipe).toEqual({ input: 'honig', output: 'met', duration: 7 });
    expect(getDef('goldschmiede').recipe).toEqual({ input: 'gold', output: 'schmuck', duration: 9 });
  });

  it('prereqs cover the core economy buildings, excluding luxury/roads/warehouses/houses', () => {
    for (const id of ['lumberjack', 'farm', 'mill', 'bakery', 'brewery', 'weavery', 'smithy', 'market', 'stable'] as const) {
      expect(LATE_GAME_PREREQS).toContain(id);
    }
    for (const id of ['imkerei', 'methaus', 'goldschmiede', 'road', 'roadStone', 'smallWarehouse', 'warehouse', 'hut'] as const) {
      expect(LATE_GAME_PREREQS).not.toContain(id);
    }
  });

  it('groups the luxury buildings in their own build-menu section', () => {
    const section = BUILD_MENU_SECTIONS.find((s) => s.ids.includes('goldschmiede'));
    expect(section?.title).toContain('Luxus');
    expect(section?.ids).toEqual(['imkerei', 'methaus', 'goldschmiede']);
  });
});
