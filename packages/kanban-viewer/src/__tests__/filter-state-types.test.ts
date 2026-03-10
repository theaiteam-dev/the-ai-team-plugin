import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AgentName } from "../types";

// Types that will be implemented in src/types/index.ts
import type {
  TypeFilter,
  AgentFilter,
  StatusFilter,
  FilterState,
} from "../types";

// Hook that will be implemented in src/hooks/use-filter-state.ts
import { useFilterState } from "../hooks/use-filter-state";

describe("Filter State Types", () => {
  describe("TypeFilter", () => {
    it("should accept 'All Types' as a valid value", () => {
      const filter: TypeFilter = "All Types";
      expect(filter).toBe("All Types");
    });

    it("should accept valid work item type values", () => {
      const types: TypeFilter[] = [
        "All Types",
        "implementation",
        "test",
        "interface",
        "integration",
        "feature",
        "bug",
        "enhancement",
      ];

      types.forEach((type) => {
        const filter: TypeFilter = type;
        expect(filter).toBe(type);
      });
    });

    it("should be compile-time type safe", () => {
      // @ts-expect-error - invalid type filter
      const invalid: TypeFilter = "invalid-type";
      expect(invalid).toBeDefined();
    });
  });

  describe("AgentFilter", () => {
    it("should accept 'All Agents' as a valid value", () => {
      const filter: AgentFilter = "All Agents";
      expect(filter).toBe("All Agents");
    });

    it("should accept 'Unassigned' as a valid value", () => {
      const filter: AgentFilter = "Unassigned";
      expect(filter).toBe("Unassigned");
    });

    it("should accept all valid AgentName values", () => {
      const agentNames: AgentName[] = [
        "Hannibal",
        "Face",
        "Murdock",
        "B.A.",
        "Amy",
        "Lynch",
      ];

      agentNames.forEach((agent) => {
        const filter: AgentFilter = agent;
        expect(filter).toBe(agent);
      });
    });

    it("should accept the full list of agent filter options", () => {
      const filters: AgentFilter[] = [
        "All Agents",
        "Hannibal",
        "Face",
        "Murdock",
        "B.A.",
        "Amy",
        "Lynch",
        "Unassigned",
      ];

      filters.forEach((filter) => {
        const agentFilter: AgentFilter = filter;
        expect(agentFilter).toBe(filter);
      });
    });

    it("should be compile-time type safe", () => {
      // @ts-expect-error - invalid agent filter
      const invalid: AgentFilter = "InvalidAgent";
      expect(invalid).toBeDefined();
    });
  });

  describe("StatusFilter", () => {
    it("should accept 'All Status' as a valid value", () => {
      const filter: StatusFilter = "All Status";
      expect(filter).toBe("All Status");
    });

    it("should accept all valid status filter values", () => {
      const statuses: StatusFilter[] = [
        "All Status",
        "Active",
        "Blocked",
        "Has Rejections",
        "Has Dependencies",
        "Completed",
      ];

      statuses.forEach((status) => {
        const filter: StatusFilter = status;
        expect(filter).toBe(status);
      });
    });

    it("should be compile-time type safe", () => {
      // @ts-expect-error - invalid status filter
      const invalid: StatusFilter = "In Progress";
      expect(invalid).toBeDefined();
    });
  });

  describe("FilterState", () => {
    it("should have all required filter fields", () => {
      const state: FilterState = {
        typeFilter: "All Types",
        agentFilter: "All Agents",
        statusFilter: "All Status",
        searchQuery: "",
      };

      expect(state.typeFilter).toBe("All Types");
      expect(state.agentFilter).toBe("All Agents");
      expect(state.statusFilter).toBe("All Status");
      expect(state.searchQuery).toBe("");
    });

    it("should accept specific filter values", () => {
      const state: FilterState = {
        typeFilter: "feature",
        agentFilter: "B.A.",
        statusFilter: "Active",
        searchQuery: "search term",
      };

      expect(state.typeFilter).toBe("feature");
      expect(state.agentFilter).toBe("B.A.");
      expect(state.statusFilter).toBe("Active");
      expect(state.searchQuery).toBe("search term");
    });

    it("should enforce proper types for each field", () => {
      const invalidType: FilterState = {
        // @ts-expect-error - typeFilter should be TypeFilter, not string
        typeFilter: "random",
        agentFilter: "All Agents",
        statusFilter: "All Status",
        searchQuery: "",
      };
      expect(invalidType).toBeDefined();
    });
  });
});

describe("useFilterState", () => {
  describe("initial state", () => {
    it("should initialize with default filter values", () => {
      const { result } = renderHook(() => useFilterState());

      expect(result.current.filterState.typeFilter).toBe("All Types");
      expect(result.current.filterState.agentFilter).toBe("All Agents");
      expect(result.current.filterState.statusFilter).toBe("All Status");
      expect(result.current.filterState.searchQuery).toBe("");
    });

    it("should return all required setter functions", () => {
      const { result } = renderHook(() => useFilterState());

      expect(typeof result.current.setTypeFilter).toBe("function");
      expect(typeof result.current.setAgentFilter).toBe("function");
      expect(typeof result.current.setStatusFilter).toBe("function");
      expect(typeof result.current.setSearchQuery).toBe("function");
      expect(typeof result.current.resetFilters).toBe("function");
    });
  });

  describe("setTypeFilter", () => {
    it("should update typeFilter when called", () => {
      const { result } = renderHook(() => useFilterState());

      act(() => {
        result.current.setTypeFilter("feature");
      });

      expect(result.current.filterState.typeFilter).toBe("feature");
    });

    it("should accept all valid TypeFilter values", () => {
      const { result } = renderHook(() => useFilterState());

      const types: TypeFilter[] = [
        "implementation",
        "test",
        "interface",
        "integration",
        "feature",
        "bug",
        "enhancement",
        "All Types",
      ];

      types.forEach((type) => {
        act(() => {
          result.current.setTypeFilter(type);
        });
        expect(result.current.filterState.typeFilter).toBe(type);
      });
    });

    it("should not affect other filter values", () => {
      const { result } = renderHook(() => useFilterState());

      act(() => {
        result.current.setAgentFilter("Murdock");
        result.current.setStatusFilter("Active");
        result.current.setSearchQuery("test");
      });

      act(() => {
        result.current.setTypeFilter("bug");
      });

      expect(result.current.filterState.typeFilter).toBe("bug");
      expect(result.current.filterState.agentFilter).toBe("Murdock");
      expect(result.current.filterState.statusFilter).toBe("Active");
      expect(result.current.filterState.searchQuery).toBe("test");
    });
  });

  describe("setAgentFilter", () => {
    it("should update agentFilter when called", () => {
      const { result } = renderHook(() => useFilterState());

      act(() => {
        result.current.setAgentFilter("B.A.");
      });

      expect(result.current.filterState.agentFilter).toBe("B.A.");
    });

    it("should accept 'Unassigned' as a valid value", () => {
      const { result } = renderHook(() => useFilterState());

      act(() => {
        result.current.setAgentFilter("Unassigned");
      });

      expect(result.current.filterState.agentFilter).toBe("Unassigned");
    });

    it("should accept all valid AgentFilter values", () => {
      const { result } = renderHook(() => useFilterState());

      const agents: AgentFilter[] = [
        "All Agents",
        "Hannibal",
        "Face",
        "Murdock",
        "B.A.",
        "Amy",
        "Lynch",
        "Unassigned",
      ];

      agents.forEach((agent) => {
        act(() => {
          result.current.setAgentFilter(agent);
        });
        expect(result.current.filterState.agentFilter).toBe(agent);
      });
    });
  });

  describe("setStatusFilter", () => {
    it("should update statusFilter when called", () => {
      const { result } = renderHook(() => useFilterState());

      act(() => {
        result.current.setStatusFilter("Blocked");
      });

      expect(result.current.filterState.statusFilter).toBe("Blocked");
    });

    it("should accept all valid StatusFilter values", () => {
      const { result } = renderHook(() => useFilterState());

      const statuses: StatusFilter[] = [
        "All Status",
        "Active",
        "Blocked",
        "Has Rejections",
        "Has Dependencies",
        "Completed",
      ];

      statuses.forEach((status) => {
        act(() => {
          result.current.setStatusFilter(status);
        });
        expect(result.current.filterState.statusFilter).toBe(status);
      });
    });
  });

  describe("setSearchQuery", () => {
    it("should update searchQuery when called", () => {
      const { result } = renderHook(() => useFilterState());

      act(() => {
        result.current.setSearchQuery("test query");
      });

      expect(result.current.filterState.searchQuery).toBe("test query");
    });

    it("should accept empty string", () => {
      const { result } = renderHook(() => useFilterState());

      act(() => {
        result.current.setSearchQuery("some text");
      });

      act(() => {
        result.current.setSearchQuery("");
      });

      expect(result.current.filterState.searchQuery).toBe("");
    });

    it("should handle special characters", () => {
      const { result } = renderHook(() => useFilterState());

      act(() => {
        result.current.setSearchQuery("test@#$%^&*()");
      });

      expect(result.current.filterState.searchQuery).toBe("test@#$%^&*()");
    });
  });

  describe("resetFilters", () => {
    it("should reset all filters to default values", () => {
      const { result } = renderHook(() => useFilterState());

      // Set all filters to non-default values
      act(() => {
        result.current.setTypeFilter("bug");
        result.current.setAgentFilter("Hannibal");
        result.current.setStatusFilter("Active");
        result.current.setSearchQuery("search term");
      });

      // Verify filters are set
      expect(result.current.filterState.typeFilter).toBe("bug");
      expect(result.current.filterState.agentFilter).toBe("Hannibal");
      expect(result.current.filterState.statusFilter).toBe("Active");
      expect(result.current.filterState.searchQuery).toBe("search term");

      // Reset all filters
      act(() => {
        result.current.resetFilters();
      });

      // Verify all filters are back to defaults
      expect(result.current.filterState.typeFilter).toBe("All Types");
      expect(result.current.filterState.agentFilter).toBe("All Agents");
      expect(result.current.filterState.statusFilter).toBe("All Status");
      expect(result.current.filterState.searchQuery).toBe("");
    });

    it("should work when filters are already at default values", () => {
      const { result } = renderHook(() => useFilterState());

      act(() => {
        result.current.resetFilters();
      });

      expect(result.current.filterState.typeFilter).toBe("All Types");
      expect(result.current.filterState.agentFilter).toBe("All Agents");
      expect(result.current.filterState.statusFilter).toBe("All Status");
      expect(result.current.filterState.searchQuery).toBe("");
    });
  });

  describe("hook return type", () => {
    it("should return filterState object with correct shape", () => {
      const { result } = renderHook(() => useFilterState());

      expect(result.current.filterState).toHaveProperty("typeFilter");
      expect(result.current.filterState).toHaveProperty("agentFilter");
      expect(result.current.filterState).toHaveProperty("statusFilter");
      expect(result.current.filterState).toHaveProperty("searchQuery");
    });

    it("should maintain stable reference for setter functions across renders", () => {
      const { result, rerender } = renderHook(() => useFilterState());

      const firstSetTypeFilter = result.current.setTypeFilter;
      const firstSetAgentFilter = result.current.setAgentFilter;
      const firstSetStatusFilter = result.current.setStatusFilter;
      const firstSetSearchQuery = result.current.setSearchQuery;
      const firstResetFilters = result.current.resetFilters;

      rerender();

      // Setter functions should be stable (useCallback)
      expect(result.current.setTypeFilter).toBe(firstSetTypeFilter);
      expect(result.current.setAgentFilter).toBe(firstSetAgentFilter);
      expect(result.current.setStatusFilter).toBe(firstSetStatusFilter);
      expect(result.current.setSearchQuery).toBe(firstSetSearchQuery);
      expect(result.current.resetFilters).toBe(firstResetFilters);
    });
  });
});
