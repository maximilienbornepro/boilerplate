import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    reporters: ['verbose'],
    projects: [
      // Shared package
      {
        test: {
          name: 'shared',
          root: '.',
          include: ['packages/shared/src/**/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Server: gateway
      {
        test: {
          name: 'server-gateway',
          root: '.',
          include: ['apps/platform/servers/unified/src/modules/__tests__/gateway/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Server: products
      {
        test: {
          name: 'server-products',
          root: '.',
          include: ['apps/platform/servers/unified/src/modules/__tests__/products/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Server: middleware
      {
        test: {
          name: 'server-middleware',
          root: '.',
          include: ['apps/platform/servers/unified/src/middleware/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Server: conges
      {
        test: {
          name: 'server-conges',
          root: '.',
          include: ['apps/platform/servers/unified/src/modules/__tests__/conges/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Client modules
      {
        test: {
          name: 'client-products',
          root: '.',
          include: ['apps/platform/src/modules/products/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'client-gateway',
          root: '.',
          include: ['apps/platform/src/modules/gateway/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'client-conges',
          root: '.',
          include: ['apps/platform/src/modules/conges/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Server: roadmap
      {
        test: {
          name: 'server-roadmap',
          root: '.',
          include: ['apps/platform/servers/unified/src/modules/__tests__/roadmap/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Client: roadmap
      {
        test: {
          name: 'client-roadmap',
          root: '.',
          include: ['apps/platform/src/modules/roadmap/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Server: suivitess
      {
        test: {
          name: 'server-suivitess',
          root: '.',
          include: ['apps/platform/servers/unified/src/modules/__tests__/suivitess/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Client: suivitess
      {
        test: {
          name: 'client-suivitess',
          root: '.',
          include: ['apps/platform/src/modules/suivitess/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Server: delivery
      {
        test: {
          name: 'server-delivery',
          root: '.',
          include: ['apps/platform/servers/unified/src/modules/__tests__/delivery/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Client: delivery
      {
        test: {
          name: 'client-delivery',
          root: '.',
          include: ['apps/platform/src/modules/delivery/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
