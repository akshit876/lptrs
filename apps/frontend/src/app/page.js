'use client';
import StyledTable2 from '@/comp/StyledTable2';
import { format } from 'date-fns';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import * as XLSX from 'xlsx';
import { useCsvData } from '../../hooks/useSocket';
import React from 'react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { useRouter } from 'next/navigation';
import { useProtectedRoute } from '../../hooks/useProtectedRoute';
import { Loader2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import useModelStore from '@/store/modelStore';
import { useSocket } from '@/SocketContext';
import { usePulseSignal } from '@/hooks/usePulseSignal';
import { useMachineEvents } from '@/hooks/useMachineEvents';
import { HourlyDataDisplayWidget } from '@/components/HourlyDataDisplayWidget';

function Page() {
  const { csvData, loading: isTableLoading } = useCsvData();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const [currentModelNumber, setCurrentModelNumber] = useState(null);
  const { selectedModel, modelFields } = useModelStore();
  const socket = useSocket();

  const { session, status } = useProtectedRoute();
  console.log({ startDate, endDate });

  // Move useRef declarations to component level
  const markingTimeoutRef = useRef(null);
  const scannerTimeoutRef = useRef(null);

  const [markingData, setMarkingData] = useState('');
  const [scannerData, setScannerData] = useState('');
  const [todayCounts, setTodayCounts] = useState({ okCount: 0, ngCount: 0 });
  const [isLoadingCounts, setIsLoadingCounts] = useState(true);

  useEffect(() => {
    const fetchTodayCounts = async () => {
      try {
        // Get today's date at 6 AM
        const today = new Date();
        // today.setHours(6, 0, 0, 0);

        const response = await fetch('/api/reports/counts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate: today.toISOString(),
            endDate: new Date().toISOString(),
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch counts');
        }

        const data = await response.json();
        setTodayCounts({
          okCount: data.okCount || 0,
          ngCount: data.ngCount || 0,
        });
      } catch (error) {
        // logger.error('Error fetching counts:', error);
        console.log({ error });
        toast.error("Failed to fetch today's counts");
      } finally {
        setIsLoadingCounts(false);
      }
    };

    fetchTodayCounts();
    const intervalId = setInterval(fetchTodayCounts, 5 * 1000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const fetchCurrentModel = async () => {
      try {
        const response = await fetch('/api/part-number/get-current');
        if (!response.ok) throw new Error('Failed to fetch current model configuration');
        const data = await response.json();

        setCurrentModelNumber(data.currentModelNumber || 'No Model Selected');
      } catch (error) {
        console.error('Error fetching current model:', error);
        toast.error('Failed to fetch current model configuration');
      }
    };

    fetchCurrentModel();
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleMarkingData = (data) => {
      setMarkingData(data.data);
    };

    const handleScannerData = (data) => {
      setScannerData(data.data);
    };

    const handleFirstScanOk = (data) => {
      toast.warning('Part already marked!', {
        description: data.message,
        duration: 3000,
      });
    };

    const handleValidationError = (data) => {
      toast.error('Validation Error', {
        description: data.details,
        duration: 5000,
      });
    };

    socket.on('marking_data', handleMarkingData);
    socket.on('scanner_read', handleScannerData);
    socket.on('first_scan_ok', handleFirstScanOk);
    socket.on('validation_error', handleValidationError);

    // Cleanup function - remove timeout refs and clearTimeout calls
    return () => {
      socket.off('marking_data', handleMarkingData);
      socket.off('scanner_read', handleScannerData);
      socket.off('first_scan_ok', handleFirstScanOk);
      socket.off('validation_error', handleValidationError);
    };
  }, [socket]);

  const handleDownloadExcel = async () => {
    console.log('Downloading Excel with date range:', startDate, endDate);

    if (!startDate || !endDate) {
      toast.error('Please select both start and end dates');
      return;
    }

    setIsLoading(true); // Optional: manage loading state
    try {
      // Fetch data from the server
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch report data');
      }

      const data = await response.json();

      console.log({ data });

      if (data.length === 0) {
        toast.error('No data found for the specified date range.');
        return;
      }

      // Format the data as per the requirements
      const formattedData = data.map((row, index) => {
        let scannerDataWithoutGrade = row.ScannerData || '';
        let grade = '';

        // Handle N/A case first
        if (row.ScannerData === 'N/A') {
          scannerDataWithoutGrade = 'N/A';
          grade = 'N/A';
        }
        // Only process grade if Result is not NG and ScannerData is not N/A
        else if (row.ScannerData !== 'NG' && row.ScannerData) {
          grade = row.ScannerData.slice(-1);
          scannerDataWithoutGrade = row.ScannerData.slice(0, -1);
        }

        return {
          SerialNumber: index + 1,
          Timestamp: format(new Date(row.Timestamp), 'dd/MM/yyyy HH:mm:ss'),
          MarkingData: row.MarkingData || '',
          ScannerData: scannerDataWithoutGrade,
          Grade: grade,
          Result: row.Result || '',
          User: row.User || '',
          remark: row.remark || '',
        };
      });

      // Create a worksheet from the formatted data
      const worksheet = XLSX.utils.json_to_sheet(formattedData);

      // Calculate column widths with additional 50px (approximately 7 characters)
      const columnWidths = Object.keys(formattedData[0]).map((key) => ({
        wch:
          Math.max(
            key.length,
            ...formattedData.map((row) => (row[key] ? row[key].toString().length : 10)),
          ) + 7, // Add approximately 50px worth of characters
      }));
      worksheet['!cols'] = columnWidths;

      // Freeze the header row
      worksheet['!freeze'] = { pos: { r: 1, c: 0 } };

      // Add conditional formatting for Result column
      const resultColumnIndex = Object.keys(formattedData[0]).findIndex((key) => key === 'Result');

      // Apply colors to all rows (excluding header)
      for (let i = 1; i <= formattedData.length; i++) {
        const cellRef = XLSX.utils.encode_cell({ r: i, c: resultColumnIndex });
        if (!worksheet[cellRef]) continue;

        const result = worksheet[cellRef].v;
        worksheet[cellRef].s = {
          fill: {
            fgColor: { rgb: result === 'OK' ? '90EE90' : result === 'NG' ? 'FFB6C1' : 'FFFFFF' },
          },
        };
      }

      // Create a new workbook and append the worksheet
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');

      // Write the workbook with style options
      const excelBuffer = XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'array',
        cellStyles: true,
      });

      // Create a Blob from the Excel binary and trigger download
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `report_${format(startDate, 'yyyy-MM-dd')}_to_${format(
        endDate,
        'yyyy-MM-dd',
      )}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);

      toast.success('Report generated successfully!');
    } catch (error) {
      toast.error('Error generating report: ' + error.message);
    } finally {
      setIsLoading(false); // Optional: manage loading state
    }
  };

  const handleScannerTrigger = () => {
    if (!socket.connected) {
      toast.error('Socket not connected');
      return;
    }
    socket.emit('scanner_trigger');
  };

  const handleMarkOn = () => {
    if (!socket.connected) {
      toast.error('Socket not connected');
      return;
    }
    socket.emit('mark_on');
  };
  const handleLigt = () => {
    if (!socket.connected) {
      toast.error('Socket not connected');
      return;
    }
    socket.emit('light_on');
  };

  // Use the pulse signal hook
  usePulseSignal(socket);

  // Add this line to use the machine events hook
  useMachineEvents(socket);

  // console.log({ csvData });
  return (
    <div className="h-screen w-full p-4 flex flex-col gap-4 bg-slate-50">
      {/* Top Cards - Single row with all elements */}
      <div className="grid grid-cols-12 gap-4">
        {/* Current Model */}
        <div className="col-span-4 p-4 rounded-xl bg-[#012B41] text-white shadow-sm">
          <p className="text-sm text-gray-300 mb-1">Current Model</p>
          <h3 className="text-xl font-semibold truncate">{currentModelNumber || 'N/A'}</h3>
        </div>

        {/* OK Count Card */}
        <div className="col-span-1 p-3 rounded-xl bg-white border-2 border-emerald-300 shadow-sm hover:border-emerald-400 transition-colors">
          <p className="text-sm font-bold text-emerald-700 mb-1">OK</p>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-emerald-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-emerald-700">
              {isLoadingCounts ? '-' : todayCounts.okCount}
            </h3>
          </div>
        </div>

        {/* NG Count Card */}
        <div className="col-span-1 p-3 rounded-xl bg-white border-2 border-red-300 shadow-sm hover:border-red-400 transition-colors">
          <p className="text-sm font-bold text-red-700 mb-1">NG</p>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-red-100 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-red-700">
              {isLoadingCounts ? '-' : todayCounts.ngCount}
            </h3>
          </div>
        </div>

        {/* Date Range and Export */}
        <div className="col-span-6 p-4 rounded-xl bg-[#012B41] text-white shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <p className="text-sm text-gray-300 mb-1">Start Date</p>
              <DatePicker
                selected={startDate}
                onChange={(date) => setStartDate(date)}
                placeholder="Start Date"
                className="w-full h-9 text-sm px-3 rounded-lg bg-white/10 border-0 text-white placeholder:text-gray-400"
              />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-300 mb-1">End Date</p>
              <DatePicker
                selected={endDate}
                onChange={(date) => setEndDate(date)}
                placeholder="End Date"
                className="w-full h-9 text-sm px-3 rounded-lg bg-white/10 border-0 text-white placeholder:text-gray-400"
              />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-300 mb-1">Export</p>
              <Button
                size="default"
                className="w-full bg-blue-500 hover:bg-blue-600 text-sm h-9 rounded-lg"
                onClick={handleDownloadExcel}
                disabled={isLoading || !startDate || !endDate}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Download'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Data Display & Controls Row */}
      <div className="grid grid-cols-12 gap-4">
        {/* Marking Data */}
        <div className="col-span-5 p-3 rounded-xl bg-white shadow-sm">
          <p className="text-xs font-medium text-gray-600 mb-1">Marking Data</p>
          <div
            className={`h-8 rounded-lg flex items-center px-3 transition-all duration-300
            ${markingData ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'}`}
          >
            <span
              className={`text-sm font-medium ${markingData ? 'text-blue-700' : 'text-gray-500'}`}
            >
              {markingData || 'Waiting for data...'}
            </span>
          </div>
        </div>

           {/* Scanner Data */}
           <div className="col-span-5 p-3 rounded-xl bg-white shadow-sm">
          <p className="text-xs font-medium text-gray-600 mb-1">Scanner Data</p>
          <div
            className={`h-8 rounded-lg flex items-center px-3 transition-all duration-300
            ${scannerData ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'}`}
          >
            <span
              className={`text-sm font-medium ${scannerData ? 'text-blue-700' : 'text-gray-500'}`}
            >
              {scannerData || 'Waiting for data...'}
            </span>
          </div>
        </div>

        {/* Control Buttons - Fixed layout */}
        <div className="col-span-2 p-3 rounded-xl bg-white shadow-sm">
          <p className="text-xs font-medium text-gray-600 mb-1">Manual Controls</p>
          <div className="flex gap-1.5">
            <Button
              className="flex-1 bg-[#012B41] hover:bg-[#023855] text-[11px] font-medium h-8 rounded-lg shadow-sm px-1"
              onClick={handleScannerTrigger}
            >
              Scanner
            </Button>
            {/* <Button
              className="flex-1 bg-[#012B41] hover:bg-[#023855] text-[11px] font-medium h-8 rounded-lg shadow-sm px-1"
              onClick={handleMarkOn}
            >
              Mark
            </Button> */}
            <Button
              className="flex-1 bg-[#012B41] hover:bg-[#023855] text-[11px] font-medium h-8 rounded-lg shadow-sm px-1"
              onClick={handleLigt}
            >
              Light
            </Button>
          </div>
        </div>
      </div>

      {/* Table section remains unchanged */}
      <div className="flex-grow rounded-xl bg-white shadow-sm">
        <div className="p-2.5 border-b border-gray-200/60 bg-white/60">
          <h2 className="text-sm font-semibold text-gray-800">Production History</h2>
        </div>
        <div className="flex-grow p-2 min-h-0">
          {isTableLoading ? (
            <div className="h-full flex items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="h-full bg-white/80 rounded-lg border border-gray-200/60 shadow-sm">
              <StyledTable2 data={csvData?.data || []} />
            </div>
          )}
        </div>
      </div>

      {/* Add the HourlyDataDisplayWidget at the end */}
      {/* <HourlyDataDisplayWidget /> */}
    </div>
  );
}

export default Page;