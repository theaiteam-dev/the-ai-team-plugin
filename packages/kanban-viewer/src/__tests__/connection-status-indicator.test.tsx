import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatusIndicator } from '../components/connection-status-indicator';

describe('ConnectionStatusIndicator', () => {
  describe('connected state', () => {
    it('should render "Live" text when status is connected', () => {
      render(<ConnectionStatusIndicator status="connected" />);
      expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('should have correct data-testid for connected state', () => {
      render(<ConnectionStatusIndicator status="connected" />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'connected');
    });
  });

  describe('connecting state', () => {
    it('should render "Connecting..." text when status is connecting', () => {
      render(<ConnectionStatusIndicator status="connecting" />);
      expect(screen.getByText('Connecting...')).toBeInTheDocument();
    });

    it('should have correct data-testid for connecting state', () => {
      render(<ConnectionStatusIndicator status="connecting" />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'connecting');
    });
  });

  describe('disconnected state', () => {
    it('should render "Disconnected" text when status is disconnected', () => {
      render(<ConnectionStatusIndicator status="disconnected" />);
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });

    it('should have correct data-testid for disconnected state', () => {
      render(<ConnectionStatusIndicator status="disconnected" />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'disconnected');
    });
  });

  describe('error state', () => {
    it('should render error message when status is error and error prop provided', () => {
      const error = new Error('Connection failed');
      render(<ConnectionStatusIndicator status="error" error={error} />);
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });

    it('should have correct data-testid for error state', () => {
      const error = new Error('Connection lost');
      render(<ConnectionStatusIndicator status="error" error={error} />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'error');
    });

    it('should render fallback text when error status but no error prop', () => {
      render(<ConnectionStatusIndicator status="error" />);
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('should render fallback text when error prop is null', () => {
      render(<ConnectionStatusIndicator status="error" error={null} />);
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  describe('custom className', () => {
    it('should apply custom className when provided', () => {
      render(<ConnectionStatusIndicator status="connected" className="custom-class" />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('should have appropriate aria-label for connected state', () => {
      render(<ConnectionStatusIndicator status="connected" />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('aria-label', 'Connection status: connected');
    });

    it('should have appropriate aria-label for connecting state', () => {
      render(<ConnectionStatusIndicator status="connecting" />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('aria-label', 'Connection status: connecting');
    });

    it('should have appropriate aria-label for disconnected state', () => {
      render(<ConnectionStatusIndicator status="disconnected" />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('aria-label', 'Connection status: disconnected');
    });

    it('should have appropriate aria-label for error state', () => {
      const error = new Error('Failed');
      render(<ConnectionStatusIndicator status="error" error={error} />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('aria-label', 'Connection status: error');
    });

    it('should have role attribute for accessibility', () => {
      render(<ConnectionStatusIndicator status="connected" />);
      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('role', 'status');
    });
  });

  describe('state transitions', () => {
    it('should update text when status changes from connecting to connected', () => {
      const { rerender } = render(<ConnectionStatusIndicator status="connecting" />);
      expect(screen.getByText('Connecting...')).toBeInTheDocument();

      rerender(<ConnectionStatusIndicator status="connected" />);
      expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('should update text when status changes from connected to disconnected', () => {
      const { rerender } = render(<ConnectionStatusIndicator status="connected" />);
      expect(screen.getByText('Live')).toBeInTheDocument();

      rerender(<ConnectionStatusIndicator status="disconnected" />);
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });

    it('should update text when status changes from disconnected to error', () => {
      const { rerender } = render(<ConnectionStatusIndicator status="disconnected" />);
      expect(screen.getByText('Disconnected')).toBeInTheDocument();

      const error = new Error('Connection timeout');
      rerender(<ConnectionStatusIndicator status="error" error={error} />);
      expect(screen.getByText('Connection timeout')).toBeInTheDocument();
    });
  });
});
