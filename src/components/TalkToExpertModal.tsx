import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, User, Bot, Loader2, MessageSquare, ExternalLink } from 'lucide-react';
import { askExpert } from '../services/gemini';
import Markdown from 'react-markdown';

interface Message {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface TalkToExpertModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  hsCode: string;
  origin: string;
  destination: string;
}

export const TalkToExpertModal: React.FC<TalkToExpertModalProps> = ({
  isOpen,
  onClose,
  productName,
  hsCode,
  origin,
  destination
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', parts: [{ text: userMessage }] }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const response = await askExpert(userMessage, messages, {
        productName,
        hsCode,
        origin,
        destination
      });

      setMessages([...newMessages, { role: 'model', parts: [{ text: response }] }]);
    } catch (error) {
      console.error('Expert chat error:', error);
      setMessages([...newMessages, { 
        role: 'model', 
        parts: [{ text: "I apologize, but I'm having trouble connecting to my knowledge base. Please try again in a moment." }] 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-[#151619] w-full max-w-2xl h-[80vh] rounded-2xl border border-white/10 flex flex-col overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="p-6 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-blue-600/20 to-transparent">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Global Trade Expert</h2>
                <p className="text-xs text-blue-400 font-mono uppercase tracking-wider">Senior Consultant • 20y Exp</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Context Banner */}
          <div className="px-6 py-2 bg-white/5 border-b border-white/10 flex items-center gap-4 text-[10px] text-white/40 uppercase tracking-widest font-mono">
            <span>Product: <span className="text-white/80">{productName}</span></span>
            <span>HS: <span className="text-white/80">{hsCode}</span></span>
            <span>Route: <span className="text-white/80">{origin} → {destination}</span></span>
          </div>

          {/* Chat Area */}
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10"
          >
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                <MessageSquare className="w-12 h-12 text-blue-400" />
                <div className="max-w-xs">
                  <p className="text-sm text-white">Ask about logistics, customs, certifications, or market entry strategies.</p>
                  <p className="text-[10px] mt-2 font-mono uppercase tracking-tighter text-blue-400">Consultant is ready for your inquiry</p>
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    msg.role === 'user' ? 'bg-white/10' : 'bg-blue-600'
                  }`}>
                    {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
                  </div>
                  <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user' 
                      ? 'bg-white/10 text-white rounded-tr-none' 
                      : 'bg-white/5 text-white/90 border border-white/10 rounded-tl-none'
                  }`}>
                    <div className="markdown-body prose prose-invert prose-sm max-w-none">
                      <Markdown>{msg.parts[0].text}</Markdown>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-3 items-center bg-white/5 border border-white/10 p-4 rounded-2xl rounded-tl-none">
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                  <span className="text-xs text-white/40 font-mono uppercase tracking-widest">Consultant is thinking...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-6 border-t border-white/10 bg-black/20">
            <div className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask your trade question..."
                className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-4 pr-14 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-lg transition-all shadow-lg shadow-blue-600/20"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            <p className="mt-3 text-[10px] text-center text-white/20 uppercase tracking-widest font-mono">
              AI-Generated Expert Advice • Verify critical steps with local professionals
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
