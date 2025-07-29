const mockTradingPost = jest.fn();
const mockTradingGet = jest.fn();
const mockTradingDelete = jest.fn();
const mockMarketGet = jest.fn();

// Mock opossum circuit breaker
jest.mock('opossum', () => {
  return jest.fn().mockImplementation((fn) => ({
    fire: fn,
    on: jest.fn()
  }));
});

jest.mock('axios', () => ({
  create: jest
    .fn()
    .mockImplementationOnce(() => ({
      get: mockTradingGet,
      post: mockTradingPost,
      delete: mockTradingDelete,
      interceptors: {
        response: {
          use: jest.fn()
        }
      }
    }))
    .mockImplementationOnce(() => ({
      get: mockMarketGet,
      interceptors: {
        response: {
          use: jest.fn()
        }
      }
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
    expect(mockMarketGet).toHaveBeenCalledWith('/stocks/AAPL/quotes/latest', { params: { feed: 'iex' } });
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

  test('getOrders fetches list', async () => {
    mockTradingGet.mockResolvedValueOnce({ data: [{ id: '1', symbol: 'AAPL' }] });
    const result = await alpacaService.getOrders(10, 'all');
    expect(mockTradingGet).toHaveBeenCalledWith('/v2/orders', { params: { limit: 10, status: 'all', direction: 'desc' } });
    expect(result).toEqual([{ id: '1', symbol: 'AAPL' }]);
  });

  test('getPortfolioHistory returns equity data', async () => {
    mockTradingGet.mockResolvedValueOnce({ data: { equity: [1, 2, 3] } });
    const result = await alpacaService.getPortfolioHistory('2023-01-01T00:00:00Z', '2023-01-01T01:00:00Z', '1Min');
    expect(mockTradingGet).toHaveBeenCalledWith('/v2/account/portfolio/history', { params: { start: '2023-01-01T00:00:00Z', end: '2023-01-01T01:00:00Z', timeframe: '1Min' } });
    expect(result).toEqual({ equity: [1, 2, 3] });
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

  test('cancelAllOrders deletes all orders', async () => {
    mockTradingDelete.mockResolvedValue({ data: { status: 'canceled' } });
    const result = await alpacaService.cancelAllOrders();
    expect(mockTradingDelete).toHaveBeenCalledWith('/v2/orders', null);
    expect(result).toEqual({ status: 'canceled' });
  });

  test('closeAllPositions liquidates portfolio', async () => {
    mockTradingDelete.mockResolvedValue({ data: { status: 'closed' } });
    const result = await alpacaService.closeAllPositions();
    expect(mockTradingDelete).toHaveBeenCalledWith('/v2/positions', null);
    expect(result).toEqual({ status: 'closed' });
  });
});
