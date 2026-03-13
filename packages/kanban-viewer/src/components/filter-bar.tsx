"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, Search, X } from "lucide-react";
import type { TypeFilter, AgentFilter, StatusFilter } from "@/types";

export interface FilterBarProps {
  typeFilter: TypeFilter;
  agentFilter: AgentFilter;
  statusFilter: StatusFilter;
  searchQuery: string;
  onTypeFilterChange: (value: TypeFilter) => void;
  onAgentFilterChange: (value: AgentFilter) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
  onSearchQueryChange: (value: string) => void;
  onClearFilters?: () => void;
}

const TYPE_OPTIONS: TypeFilter[] = [
  "All Types",
  "implementation",
  "test",
  "interface",
  "integration",
  "feature",
  "bug",
  "enhancement",
];

const AGENT_OPTIONS: AgentFilter[] = [
  "All Agents",
  "Hannibal",
  "Face",
  "Murdock",
  "B.A.",
  "Amy",
  "Lynch",
  "Unassigned",
];

const STATUS_OPTIONS: StatusFilter[] = [
  "All Status",
  "Active",
  "Blocked",
  "Has Rejections",
  "Has Dependencies",
  "Completed",
];

export interface DropdownHandle {
  close: () => void;
}

interface DropdownProps<T extends string> {
  testId: string;
  value: T;
  options: T[];
  onChange: (value: T) => void;
  isActive?: boolean;
  dropdownRef?: React.RefObject<DropdownHandle | null>;
}

function Dropdown<T extends string>({
  testId,
  value,
  options,
  onChange,
  isActive = false,
  dropdownRef,
}: DropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);

  // Expose close method via ref
  React.useImperativeHandle(dropdownRef, () => ({
    close: () => {
      setIsOpen(false);
    },
  }), []);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleSelect = (option: T) => {
    onChange(option);
    setIsOpen(false);
  };

  const activeClasses = isActive
    ? "bg-green-500/20 border-green-500"
    : "bg-gray-700 border-transparent";

  return (
    <div className="relative">
      <button
        type="button"
        data-testid={testId}
        className={`flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-gray-600 rounded-md min-w-[120px] text-white text-sm border ${activeClasses}`}
        onClick={handleToggle}
      >
        <span>{value}</span>
        <ChevronDown
          data-testid="chevron-down-icon"
          className="w-4 h-4 text-gray-400"
        />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-gray-700 rounded-md shadow-lg z-50 min-w-[120px]">
          {options.map((option) => (
            <div
              key={option}
              role="option"
              aria-label={option}
              aria-selected={value === option}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-600 text-sm ${
                value === option ? "text-green-500" : "text-white"
              }`}
              onClick={() => handleSelect(option)}
            >
              {value === option && (
                <Check
                  data-testid="check-icon"
                  className="w-4 h-4"
                />
              )}
              <span className={value === option ? "" : "ml-6"}>{option}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilterBar({
  typeFilter,
  agentFilter,
  statusFilter,
  searchQuery,
  onTypeFilterChange,
  onAgentFilterChange,
  onStatusFilterChange,
  onSearchQueryChange,
  onClearFilters,
}: FilterBarProps) {
  const [localSearchValue, setLocalSearchValue] = useState(searchQuery);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const typeDropdownRef = useRef<DropdownHandle>(null);
  const agentDropdownRef = useRef<DropdownHandle>(null);
  const statusDropdownRef = useRef<DropdownHandle>(null);

  // Sync local value with prop when prop changes externally
  useEffect(() => {
    setLocalSearchValue(searchQuery);
  }, [searchQuery]);

  // Helper to close all dropdowns
  const closeAllDropdowns = () => {
    typeDropdownRef.current?.close();
    agentDropdownRef.current?.close();
    statusDropdownRef.current?.close();
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isSearchInput = target === searchInputRef.current;
      const isInputElement = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Handle Escape key
      if (event.key === 'Escape') {
        // Close dropdowns
        closeAllDropdowns();

        // If search input is focused, clear it
        if (isSearchInput) {
          setLocalSearchValue('');
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          onSearchQueryChange('');
          searchInputRef.current?.blur();
        }
        return;
      }

      // Do not trigger focus shortcuts when typing in any input element
      if (isInputElement) {
        return;
      }

      // Handle "/" key to focus search
      if (event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Handle Cmd+K (Mac) or Ctrl+K (Windows/Linux) to focus search
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onSearchQueryChange]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalSearchValue(value);

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      onSearchQueryChange(value);
    }, 300);
  };

  const handleSearchClear = () => {
    setLocalSearchValue("");
    // Clear without debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    onSearchQueryChange("");
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const isTypeActive = typeFilter !== "All Types";
  const isAgentActive = agentFilter !== "All Agents";
  const isStatusActive = statusFilter !== "All Status";
  const isSearchActive = searchQuery !== "";
  const hasActiveFilters =
    isTypeActive || isAgentActive || isStatusActive || isSearchActive;

  return (
    <div
      data-testid="filter-bar"
      className="flex items-center gap-4 px-4 h-12 bg-gray-800"
    >
      <span className="text-xs font-medium text-gray-500">Filter by:</span>
      <Dropdown
        testId="type-filter-dropdown"
        value={typeFilter}
        options={TYPE_OPTIONS}
        onChange={onTypeFilterChange}
        isActive={isTypeActive}
        dropdownRef={typeDropdownRef}
      />
      <Dropdown
        testId="agent-filter-dropdown"
        value={agentFilter}
        options={AGENT_OPTIONS}
        onChange={onAgentFilterChange}
        isActive={isAgentActive}
        dropdownRef={agentDropdownRef}
      />
      <Dropdown
        testId="status-filter-dropdown"
        value={statusFilter}
        options={STATUS_OPTIONS}
        onChange={onStatusFilterChange}
        isActive={isStatusActive}
        dropdownRef={statusDropdownRef}
      />
      {hasActiveFilters && onClearFilters && (
        <button
          type="button"
          data-testid="clear-filters-button"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-white"
          onClick={onClearFilters}
        >
          <X data-testid="clear-filters-icon" className="w-3 h-3" />
          <span>Clear filters</span>
        </button>
      )}

      {/* Search input */}
      <div
        data-testid="search-container"
        className="relative ml-auto w-[200px]"
      >
        <Search
          data-testid="search-icon"
          className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
        />
        <input
          ref={searchInputRef}
          type="text"
          data-testid="search-input"
          value={localSearchValue}
          onChange={handleSearchChange}
          placeholder="Search..."
          className="w-full bg-gray-700 rounded-md pl-8 pr-8 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
        />
        {searchQuery && (
          <button
            type="button"
            data-testid="search-clear-button"
            onClick={handleSearchClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
          >
            <X
              data-testid="search-clear-icon"
              className="w-4 h-4"
            />
          </button>
        )}
      </div>
    </div>
  );
}
