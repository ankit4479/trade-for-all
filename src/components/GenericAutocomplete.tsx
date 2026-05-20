import React, { useState, useEffect, useRef } from 'react';
import { MapPin, X, Check } from 'lucide-react';

interface GenericAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  icon?: React.ReactNode;
}

export const GenericAutocomplete: React.FC<GenericAutocompleteProps> = ({ value, onChange, options, placeholder, icon }) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    if (val.length > 0) {
      const filtered = options.filter(opt => 
        opt.toLowerCase().includes(val.toLowerCase())
      ).slice(0, 10); // Limit to 10 suggestions
      setSuggestions(filtered);
      setIsOpen(true);
    } else {
      setSuggestions([]);
      setIsOpen(false);
    }
  };

  const handleSuggestionClick = (opt: string) => {
    onChange(opt);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4">
        {icon || <MapPin className="w-4 h-4" />}
      </div>
      <input 
        type="text" 
        value={value} 
        onChange={handleInputChange} 
        placeholder={placeholder} 
        className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all" 
      />
      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((opt) => (
            <li 
              key={opt} 
              onClick={() => handleSuggestionClick(opt)}
              className="px-4 py-2 hover:bg-emerald-50 cursor-pointer text-slate-700 text-sm"
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
