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

describe('alpacaService', () => {
  beforeEach(() => {
    mockTradingPost.mockReset();
    mockTradingGet.mockReset();
    mockTradingDelete.mockReset();
    mockMarketGet.mockReset();
  });

  test('getMarketData parses quote', async () => {
    mockMarketGet.mockResolvedValue({
      data: { quote: { bp: '10', ap: '11', bs: '1', as: '2', timestamp: '2023-01-01T00:00:00Z' } }
    });
    const data = await alpacaService.getMarketData('AAPL');
    expect(mockMarketGet).toHaveBeenCalledWith('/stocks/AAPL/quotes/latest', { timeout: 5000, params: { feed: 'iex' } });
    expect(data).toMatchObject({ symbol: 'AAPL', bid: 10, ask: 11, bidSize: 1, askSize: 2 });
    expect(data.timestamp).toBeInstanceOf(Date);
  });

  test('submitOrder sends order details', async () => {
    const order = { symbol: 'AAPL', qty: 1, side: 'buy', type: 'market', time_in_force: 'day' };
    mockTradingPost.mockResolvedValue({ data: { id: '123' } });
    const result = await alpacaService.submitOrder(order);
    expect(mockTradingPost).toHaveBeenCalledWith('/v2/orders', order);
    expect(result).toEqual({ id: '123' });
  });

  test('submitOrder validates fields', async () => {
    await expect(alpacaService.submitOrder({ symbol: 'AAPL' })).rejects.toThrow(/Missing required fields/);
  });

  test('compareWithSP500 calculates gains', async () => {
    mockTradingGet.mockResolvedValueOnce({ data: { equity: [100000, 101000] } });
    mockMarketGet.mockResolvedValueOnce({ data: { bars: [{ c: 400 }, { c: 404 }] } });
    const result = await alpacaService.compareWithSP500('2023-01-01', '2023-01-08');
    expect(mockTradingGet).toHaveBeenCalledWith('/v2/account/portfolio/history', { params: { start: '2023-01-01', end: '2023-01-08', timeframe: '1Day' } });
    expect(mockMarketGet).toHaveBeenCalledWith('/v2/stocks/SPY/bars', { params: { timeframe: '1Day', start: '2023-01-01', end: '2023-01-08' } });
    expect(result).toEqual({
      startEquity: 100000,
      endEquity: 101000,
      accountGain: 1000,
      spyGain: 1000,
      relativeGain: 0
    });
  });
});
