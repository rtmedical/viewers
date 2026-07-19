import guid from './guid';

describe('guid', () => {
  const guidValue = guid();

  test('should return an RFC 4122 version 4 GUID', () => {
    expect(guidValue).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  test('should always return a guid of size 36', () => {
    expect(guidValue.length).toBe(36);
  });

  test('should always return a guid with five sequences', () => {
    expect(guidValue.split('-').length).toBe(5);
  });

  test('should always return a guid with four dashes', () => {
    expect(guidValue.split('-').length - 1).toBe(4);
  });

  test('should return the first sequence with length of eigth', () => {
    expect(guidValue.split('-')[0].length).toBe(8);
  });

  test('should return the second sequence with length of four', () => {
    expect(guidValue.split('-')[1].length).toBe(4);
  });

  test('should return the third sequence with length of four', () => {
    expect(guidValue.split('-')[2].length).toBe(4);
  });

  test('should return the fourth sequence with length of four', () => {
    expect(guidValue.split('-')[3].length).toBe(4);
  });

  test('should return the last sequence with length of twelve', () => {
    expect(guidValue.split('-')[4].length).toBe(12);
  });
});
