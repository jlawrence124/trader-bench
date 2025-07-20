const mockTradingPost = jest.fn();
const mockTradingGet = jest.fn();
const mockTradingDelete = jest.fn();
const mockMarketGet = jest.fn();

jest.mock('axios', () => ({
  create: jest
    .fn()
    .mockImplementationOnce(() => ({
      get: mockTradingGet,
      post: mockTradingPost,
      delete: mockTradingDelete
    }))
    .mockImplementationOnce(() => ({
      get: mockMarketGet
    }))
}));

const alpacaService = require('../src/alpacaService');
const portfolioHistory = require('./mockData/portfolioHistory.json');
const spyBars = require('./mockData/spyBars.json');
const picks = require('./mockData/picks.json');

// picks is currently unused but represents the trades for this period

describe('historical comparison against S&P 500', () => {
  beforeEach(() => {
    mockTradingPost.mockReset();
    mockTradingGet.mockReset();
    mockTradingDelete.mockReset();
    mockMarketGet.mockReset();
  });

  test('returns correct relative gain for mocked history', async () => {
    mockTradingGet.mockResolvedValueOnce({ data: portfolioHistory });
    mockMarketGet.mockResolvedValueOnce({ data: spyBars });

    const result = await alpacaService.compareWithSP500('2023-01-01', '2023-01-02');

    expect(result).toEqual({
      startEquity: 100000,
      endEquity: 110000,
      accountGain: 10000,
      spyGain: 5000,
      relativeGain: 5000
    });
  });
});
