import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, FileText, Download, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface DocumentGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  hsCode: string;
  originCountry: string;
  destinationCountry: string;
}

export const DocumentGeneratorModal: React.FC<DocumentGeneratorModalProps> = ({
  isOpen,
  onClose,
  productName,
  hsCode,
  originCountry,
  destinationCountry,
}) => {
  const [selectedDocType, setSelectedDocType] = useState<'COMMERCIAL_INVOICE' | 'CERTIFICATE_OF_ORIGIN'>('COMMERCIAL_INVOICE');
  const [factoryAddress, setFactoryAddress] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [quantity, setQuantity] = useState('100');
  const [unitPrice, setUnitPrice] = useState('10');
  const [currency, setCurrency] = useState('USD');
  const [isGenerating, setIsGenerating] = useState(false);

  const generateCommercialInvoice = () => {
    setIsGenerating(true);
    
    setTimeout(() => {
      try {
        const doc = new jsPDF();
        
        // Header
        doc.setFontSize(22);
        doc.text('COMMERCIAL INVOICE', 105, 20, { align: 'center' });
        
        doc.setFontSize(10);
        doc.text(`Date: ${new Date().toLocaleDateString()}`, 150, 30);
        doc.text(`Invoice No: INV-${Math.floor(Math.random() * 10000)}`, 150, 35);
        
        // Addresses
        doc.setFontSize(12);
        doc.text('Shipper / Exporter:', 14, 45);
        doc.setFontSize(10);
        const factoryLines = doc.splitTextToSize(factoryAddress || 'N/A', 80);
        doc.text(factoryLines, 14, 52);
        
        doc.setFontSize(12);
        doc.text('Consignee / Buyer:', 110, 45);
        doc.setFontSize(10);
        const buyerLines = doc.splitTextToSize(buyerAddress || 'N/A', 80);
        doc.text(buyerLines, 110, 52);
        
        // Shipping Details
        doc.setFontSize(10);
        doc.text(`Country of Origin: ${originCountry}`, 14, 80);
        doc.text(`Country of Destination: ${destinationCountry}`, 110, 80);
        
        // Table
        const qty = parseFloat(quantity) || 0;
        const price = parseFloat(unitPrice) || 0;
        const total = qty * price;
        
        autoTable(doc, {
          startY: 90,
          head: [['Description of Goods', 'HS Code', 'Quantity', 'Unit Price', 'Total Amount']],
          body: [
            [productName, hsCode, qty.toString(), `${currency} ${price.toFixed(2)}`, `${currency} ${total.toFixed(2)}`],
          ],
          theme: 'grid',
          headStyles: { fillColor: [66, 133, 244] },
        });
        
        // Footer
        const finalY = (doc as any).lastAutoTable.finalY || 120;
        doc.text(`Total Value: ${currency} ${total.toFixed(2)}`, 150, finalY + 10);
        
        doc.text('Declaration:', 14, finalY + 30);
        doc.setFontSize(8);
        doc.text('We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', 14, finalY + 35);
        
        doc.text('Signature: ___________________________', 14, finalY + 55);
        
        doc.save(`Commercial_Invoice_${productName.replace(/\s+/g, '_')}.pdf`);
      } catch (error) {
        console.error("Error generating PDF:", error);
        alert("Failed to generate PDF. Please try again.");
      } finally {
        setIsGenerating(false);
        onClose();
      }
    }, 1000); // Simulate a slight delay for better UX
  };

  const generateCertificateOfOrigin = () => {
    setIsGenerating(true);
    
    setTimeout(() => {
      try {
        const doc = new jsPDF();
        
        // Header
        doc.setFontSize(22);
        doc.text('CERTIFICATE OF ORIGIN', 105, 20, { align: 'center' });
        
        doc.setFontSize(10);
        doc.text(`Date: ${new Date().toLocaleDateString()}`, 150, 30);
        doc.text(`Certificate No: CO-${Math.floor(Math.random() * 10000)}`, 150, 35);
        
        // Addresses
        doc.setFontSize(12);
        doc.text('Exporter:', 14, 45);
        doc.setFontSize(10);
        const factoryLines = doc.splitTextToSize(factoryAddress || 'N/A', 80);
        doc.text(factoryLines, 14, 52);
        
        doc.setFontSize(12);
        doc.text('Consignee:', 110, 45);
        doc.setFontSize(10);
        const buyerLines = doc.splitTextToSize(buyerAddress || 'N/A', 80);
        doc.text(buyerLines, 110, 52);
        
        // Origin Details
        doc.setFontSize(12);
        doc.text('Origin Declaration:', 14, 85);
        doc.setFontSize(10);
        doc.text(`The undersigned hereby declares that the goods described below originate in:`, 14, 92);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(originCountry.toUpperCase(), 14, 100);
        doc.setFont('helvetica', 'normal');
        
        // Table
        autoTable(doc, {
          startY: 110,
          head: [['Description of Goods', 'HS Code', 'Quantity']],
          body: [
            [productName, hsCode, quantity],
          ],
          theme: 'grid',
          headStyles: { fillColor: [16, 185, 129] },
        });
        
        const finalY = (doc as any).lastAutoTable.finalY || 140;
        
        doc.setFontSize(10);
        doc.text('Certification:', 14, finalY + 20);
        doc.setFontSize(8);
        doc.text('It is hereby certified that the goods described above originate in the country shown.', 14, finalY + 25);
        
        doc.text('Authorized Signature: ___________________________', 14, finalY + 45);
        doc.text('Date of Issue: ___________________________', 110, finalY + 45);
        
        doc.save(`Certificate_of_Origin_${productName.replace(/\s+/g, '_')}.pdf`);
      } catch (error) {
        console.error("Error generating PDF:", error);
        alert("Failed to generate PDF. Please try again.");
      } finally {
        setIsGenerating(false);
        onClose();
      }
    }, 1000);
  };

  const handleGenerate = () => {
    if (selectedDocType === 'COMMERCIAL_INVOICE') {
      generateCommercialInvoice();
    } else {
      generateCertificateOfOrigin();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Generate Trade Documents</h3>
                  <p className="text-xs text-slate-500 font-medium">Auto-generate compliance PDFs for {destinationCountry}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <div className="flex gap-2 mb-6 p-1 bg-slate-100 rounded-2xl">
                <button 
                  onClick={() => setSelectedDocType('COMMERCIAL_INVOICE')}
                  className={`flex-1 py-2 px-4 rounded-xl text-sm font-bold transition-all ${selectedDocType === 'COMMERCIAL_INVOICE' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Commercial Invoice
                </button>
                <button 
                  onClick={() => setSelectedDocType('CERTIFICATE_OF_ORIGIN')}
                  className={`flex-1 py-2 px-4 rounded-xl text-sm font-bold transition-all ${selectedDocType === 'CERTIFICATE_OF_ORIGIN' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Certificate of Origin
                </button>
              </div>

              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 mb-6">
                <p className="text-sm text-emerald-800 leading-relaxed">
                  {selectedDocType === 'COMMERCIAL_INVOICE' ? (
                    <>Generate a standard <strong>Commercial Invoice</strong> required for customs clearance.</>
                  ) : (
                    <>Generate a <strong>Certificate of Origin</strong> to certify where your products were manufactured.</>
                  )}
                  Fill in the details below to create your PDF document.
                </p>
              </div>
              
              <form className="space-y-5" onSubmit={(e) => {
                e.preventDefault();
                handleGenerate();
              }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Shipper / Factory Address</label>
                    <textarea 
                      value={factoryAddress}
                      onChange={(e) => setFactoryAddress(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none h-24"
                      placeholder="Your company name, address, contact info..."
                      required
                    ></textarea>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Consignee / Buyer Address</label>
                    <textarea 
                      value={buyerAddress}
                      onChange={(e) => setBuyerAddress(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none h-24"
                      placeholder="Buyer's company name, address, contact info..."
                      required
                    ></textarea>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Quantity</label>
                    <input 
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      required
                      min="1"
                    />
                  </div>
                  {selectedDocType === 'COMMERCIAL_INVOICE' && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Unit Price</label>
                        <input 
                          type="number"
                          value={unitPrice}
                          onChange={(e) => setUnitPrice(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                          required
                          min="0.01"
                          step="0.01"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Currency</label>
                        <select 
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                        >
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                          <option value="GBP">GBP</option>
                          <option value="INR">INR</option>
                          <option value="CNY">CNY</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex justify-end pt-4 border-t border-slate-100">
                  <button 
                    type="submit"
                    disabled={isGenerating}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-bold rounded-xl transition-colors shadow-sm flex items-center gap-2"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating PDF...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Generate {selectedDocType === 'COMMERCIAL_INVOICE' ? 'Commercial Invoice' : 'Certificate of Origin'}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
