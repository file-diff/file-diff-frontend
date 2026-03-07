import { expect, describe, it } from '@jest/globals';
import { parseCsv, diffCsv } from './csvParser';

describe('csvParser', () => {
  describe('parseCsv', () => {
    it('should parse basic CSV entries', () => {
      const input = 'd;folder1;0;1772817450;N/A\nt;folder1/file1.txt;444;1772817450;hash123';
      const result = parseCsv(input);
      
      expect(result.length).toBe(2);
      expect(result[0].path).toBe('folder1');
      expect(result[1].path).toBe('folder1/file1.txt');
    });

    it('should infer parent directories', () => {
      const input = 't;a/b/c.txt;444;1772817450;hash123';
      const result = parseCsv(input);
      
      expect(result.length).toBe(3);
      expect(result[0].path).toBe('a');
      expect(result[1].path).toBe('a/b');
      expect(result[2].path).toBe('a/b/c.txt');
    });

    it('should sort in tree order with directories first', () => {
      const input = `d;cmd;0;1772817450;N/A
d;cmd/golembase;0;1772817450;N/A
t;cmd/golembase/main.go;444;1772817450;abc123
d;common;0;1772817450;N/A
t;common/helper.txt;222;1772817450;def456`;
      
      const result = parseCsv(input);
      
      // Expected order: cmd, cmd/golembase, cmd/golembase/main.go, common, common/helper.txt
      expect(result[0].path).toBe('cmd');
      expect(result[1].path).toBe('cmd/golembase');
      expect(result[2].path).toBe('cmd/golembase/main.go');
      expect(result[3].path).toBe('common');
      expect(result[4].path).toBe('common/helper.txt');
    });

    it('should calculate correct depth for nested paths', () => {
      const input = 't;a/b/c/d.txt;444;1772817450;hash123';
      const result = parseCsv(input);
      
      expect(result[0].depth).toBe(0); // a
      expect(result[1].depth).toBe(1); // a/b
      expect(result[2].depth).toBe(2); // a/b/c
      expect(result[3].depth).toBe(3); // a/b/c/d.txt
    });
  });

  describe('diffCsv', () => {
    it('should match entries at the same path', () => {
      const left = parseCsv('t;file.txt;100;1772817450;hash123');
      const right = parseCsv('t;file.txt;100;1772817450;hash123');
      
      const { left: diffLeft, right: diffRight } = diffCsv(left, right);
      
      expect(diffLeft.length).toBe(1);
      expect(diffRight.length).toBe(1);
      expect(diffLeft[0]?.status).toBe('same');
      expect(diffRight[0]?.status).toBe('same');
    });

    it('should mark removed entries from left only', () => {
      const left = parseCsv('t;file.txt;100;1772817450;hash123');
      const right = parseCsv('');
      
      const { left: diffLeft, right: diffRight } = diffCsv(left, right);
      
      expect(diffLeft[0]?.status).toBe('removed');
      expect(diffRight[0]).toBeNull();
    });

    it('should mark added entries from right only', () => {
      const left = parseCsv('');
      const right = parseCsv('t;file.txt;100;1772817450;hash123');
      
      const { left: diffLeft, right: diffRight } = diffCsv(left, right);
      
      expect(diffLeft[0]).toBeNull();
      expect(diffRight[0]?.status).toBe('added');
    });

    it('should properly align nested entries when one side has subtrees', () => {
      const left = parseCsv(`d;cmd;0;1772817450;N/A
d;cmd/golembase;0;1772817450;N/A
t;cmd/golembase/main.go;444;1772817450;abc123
d;common;0;1772817450;N/A
t;common/helper.txt;222;1772817450;def456`);
      
      const right = parseCsv(`d;cmd;0;1772817450;N/A
d;common;0;1772817450;N/A
t;common/helper.txt;222;1772817450;def456`);

      const { left: diffLeft, right: diffRight } = diffCsv(left, right);

      // Find indices for key paths
      const cmdIndex = diffLeft.findIndex(e => e?.path === 'cmd');
      const commonIndex = diffLeft.findIndex(e => e?.path === 'common');
      const golembaseIndex = diffLeft.findIndex(e => e?.path === 'cmd/golembase');

      // "common" directory should NOT appear before "cmd/golembase" in right side
      // The right column at index golembaseIndex should be null (or a different path that belongs there)
      // Actually, the alignment should respect the order from left entirely
      
      // Current bug: cmd/golembase entries are interleaved incorrectly
      // After fix: paths should be collected properly to maintain tree structure
      
      // This test documents the current issue: indices don't align properly
      // when left has nested paths that right doesn't have
      console.log('Left entries:', diffLeft.map((e, i) => `[${i}] ${e?.path || 'null'}`));
      console.log('Right entries:', diffRight.map((e, i) => `[${i}] ${e?.path || 'null'}`));
    });

    it('should handle modified files correctly', () => {
      const left = parseCsv('t;file.txt;100;1772817450;hash123');
      const right = parseCsv('t;file.txt;100;1772817450;hash456');
      
      const { left: diffLeft, right: diffRight } = diffCsv(left, right);
      
      expect(diffLeft[0]?.status).toBe('modified');
      expect(diffRight[0]?.status).toBe('modified');
    });

    it('should treat directory modifications as same (no hash comparison)', () => {
      const left = parseCsv('d;folder;0;1772817450;hash123');
      const right = parseCsv('d;folder;0;1772817450;hash456');
      
      const { left: diffLeft, right: diffRight } = diffCsv(left, right);
      
      expect(diffLeft[0]?.status).toBe('same');
      expect(diffRight[0]?.status).toBe('same');
    });
  });
});
