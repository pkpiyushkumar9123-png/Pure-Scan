import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Scan, 
  History, 
  Settings, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight, 
  Play, 
  Loader2,
  X,
  Info,
  ChevronDown,
  CameraOff,
  RefreshCw,
  Crop as CropIcon,
  Check,
  Edit3,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import Cropper from 'react-easy-crop';
import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';

// --- Types ---
interface Ingredient {
  name: string;
  risk: 'low' | 'medium' | 'high';
  description: string;
  implications: string;
}

interface ScanResult {
  id: string;
  timestamp: number;
  productName: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number; // 0-100
  riskyIngredients: Ingredient[];
  alternative: {
    name: string;
    reason: string;
  };
}

// --- Mock Data ---
const MOCK_RESULT: ScanResult = {
  id: 'mock-1',
  timestamp: Date.now(),
  productName: "Ultra-Processed Granola Bar",
  grade: 'D',
  score: 35,
  riskyIngredients: [
    { 
      name: "High Fructose Corn Syrup", 
      risk: 'high', 
      description: "A highly refined sweetener made from corn starch.",
      implications: "Regular consumption is linked to increased risk of obesity, type 2 diabetes, and non-alcoholic fatty liver disease. It bypasses normal digestion and goes straight to the liver, triggering fat production."
    },
    { 
      name: "Palm Oil", 
      risk: 'medium', 
      description: "An edible vegetable oil derived from the fruit of oil palms.",
      implications: "High in saturated fats which can raise LDL (bad) cholesterol levels. Large-scale production is also a major driver of deforestation and habitat loss for endangered species."
    },
    { 
      name: "Artificial Flavors", 
      risk: 'medium', 
      description: "Chemical mixtures created in labs to mimic natural tastes.",
      implications: "While generally recognized as safe, some people experience sensitivities or allergic reactions. They are often used to mask the lack of real ingredients in highly processed foods."
    },
    { 
      name: "Red 40", 
      risk: 'high', 
      description: "A synthetic food dye derived from petroleum.",
      implications: "Some studies suggest a link to hyperactivity and behavioral issues in children. It is banned or requires warning labels in several European countries due to potential health concerns."
    }
  ],
  alternative: {
    name: "Kind Whole Grain Bar",
    reason: "Contains 50% less sugar and uses natural honey as a sweetener."
  }
};

const YOUTUBE_VIDEOS = [
  { id: '1', title: "Hidden Sugars in 'Healthy' Snacks", thumbnail: "https://picsum.photos/seed/sugar/320/180" },
  { id: '2', title: "The Truth About Granola Bars", thumbnail: "https://picsum.photos/seed/granola/320/180" },
  { id: '3', title: "How to Read Food Labels Like a Pro", thumbnail: "https://picsum.photos/seed/labels/320/180" },
];

// --- Components ---

const CircularProgress = ({ score, grade }: { score: number; grade: string }) => {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 80) return '#10B981'; // emerald-500
    if (s >= 60) return '#84CC16'; // lime-500
    if (s >= 40) return '#F59E0B'; // amber-500
    if (s >= 20) return '#F97316'; // orange-500
    return '#EF4444'; // red-500
  };

  const color = getColor(score);

  return (
    <div className="relative flex items-center justify-center w-32 h-32 shrink-0">
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke="#F3F4F6"
          strokeWidth="8"
          fill="transparent"
        />
        <motion.circle
          cx="50"
          cy="50"
          r={radius}
          stroke={color}
          strokeWidth="8"
          fill="transparent"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}40)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <motion.span 
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-5xl font-black leading-none" 
          style={{ color }}
        >
          {grade}
        </motion.span>
        <span className="text-[10px] font-bold tracking-widest text-gray-400 mt-1 uppercase">Score {score}</span>
      </div>
    </div>
  );
};

export default function App() {
  const [status, setStatus] = useState<'idle' | 'detecting' | 'cropping' | 'extracting' | 'editing' | 'analyzing' | 'result'>('idle');
  const [activeTab, setActiveTab] = useState('scan');
  const [showProfile, setShowProfile] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [extractedIngredients, setExtractedIngredients] = useState<string>("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  
  // Load history from local storage and sync with Supabase
  useEffect(() => {
    const saved = localStorage.getItem('purescan_history');
    if (saved) setHistory(JSON.parse(saved));

    // Listen for auth changes
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Sync history with Supabase when user logs in
  useEffect(() => {
    if (user) {
      const fetchHistory = async () => {
        const { data, error } = await supabase
          .from('scans')
          .select('*')
          .order('timestamp', { ascending: false });
        
        if (data && !error) {
          setHistory(prev => {
            // Merge and deduplicate by ID
            const combined = [...data, ...prev];
            const unique = combined.filter((item, index, self) =>
              index === self.findIndex((t) => t.id === item.id)
            );
            localStorage.setItem('purescan_history', JSON.stringify(unique));
            return unique;
          });
        } else if (error) {
          console.error("Failed to fetch history from Supabase:", error);
        }
      };
      fetchHistory();
    }
  }, [user]);

  const handleSocialLogin = async (provider: 'google' | 'facebook' | 'apple') => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err) {
      console.error('Login error:', err);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setShowProfile(false);
  };

  const saveToHistory = async (result: ScanResult) => {
    setHistory(prev => {
      const newHistory = [result, ...prev];
      localStorage.setItem('purescan_history', JSON.stringify(newHistory));
      return newHistory;
    });

    if (user) {
      const { error } = await supabase.from('scans').insert([{
        ...result,
        user_id: user.id
      }]);
      if (error) console.error("Supabase sync failed:", error);
    }
  };
  
  // Cropper State
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- AI Logic ---
  const autoDetectLabel = async (base64Data: string) => {
    try {
      setStatus('detecting');
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is missing. Please add it to your environment variables in AI Studio Settings.");
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Data.split(',')[1],
                },
              },
              {
                text: "Find the nutrition facts label AND the ingredients list in this image. Return a single bounding box that covers BOTH areas. If they are separate, return a box that includes both. The coordinates should be normalized from 0 to 1000 (where 0,0 is top-left and 1000,1000 is bottom-right). Return as JSON: {x, y, width, height}.",
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              width: { type: Type.NUMBER },
              height: { type: Type.NUMBER },
            },
            required: ['x', 'y', 'width', 'height'],
          }
        }
      });

      const box = JSON.parse(response.text);
      
      // Calculate initial crop and zoom for react-easy-crop
      // This is a rough estimation to center the detected box
      const zoomVal = Math.max(1, Math.min(3, 800 / Math.max(box.width, box.height)));
      setZoom(zoomVal);
      
      // react-easy-crop 'crop' is displacement from center in percentage
      // Normalized center of box:
      const ncx = (box.x + box.width / 2) / 1000;
      const ncy = (box.y + box.height / 2) / 1000;
      
      // Convert to react-easy-crop displacement
      // This is still an approximation as it depends on image aspect ratio
      setCrop({
        x: (0.5 - ncx) * 100 * zoomVal,
        y: (0.5 - ncy) * 100 * zoomVal
      });

      setStatus('cropping');
    } catch (error) {
      console.error("Auto-detection failed:", error);
      // Fallback to manual crop
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setStatus('cropping');
    }
  };

  const extractIngredients = async (base64Data: string) => {
    try {
      setStatus('extracting');
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is missing. Please add it to your environment variables in AI Studio Settings.");
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Data.split(',')[1],
                },
              },
              {
                text: "Extract the ingredients list and any nutrition facts (like calories, sugar, protein) from this image. Look for text starting with 'Ingredients:', 'CONTAINS:', or a 'Nutrition Facts' table. Return the extracted information as a clean, comma-separated list of text. If no ingredients or nutrition facts are found, return 'No ingredients detected'.",
              },
            ],
          },
        ],
      });

      const text = response.text || "";
      setExtractedIngredients(text);
      setStatus('editing');
    } catch (error) {
      console.error("AI Extraction failed:", error);
      alert("Failed to extract ingredients. Please try again.");
      setStatus('idle');
    }
  };

  const analyzeIngredients = async (ingredientsText: string) => {
    try {
      setStatus('analyzing');
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is missing. Please add it to your environment variables in AI Studio Settings.");
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Analyze this food data (ingredients and/or nutrition facts): "${ingredientsText}". Identify the product name (if possible from context or generic), calculate a health grade (A-F) and score (0-100), list risky ingredients or nutritional concerns with descriptions and health implications, and suggest a healthier alternative.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              productName: { type: Type.STRING },
              grade: { type: Type.STRING, enum: ['A', 'B', 'C', 'D', 'F'] },
              score: { type: Type.NUMBER },
              riskyIngredients: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    risk: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                    description: { type: Type.STRING },
                    implications: { type: Type.STRING },
                  },
                  required: ['name', 'risk', 'description', 'implications'],
                },
              },
              alternative: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ['name', 'reason'],
              },
            },
            required: ['productName', 'grade', 'score', 'riskyIngredients', 'alternative'],
          },
        },
      });

      const result = JSON.parse(response.text);
      const finalResult: ScanResult = {
        ...result,
        id: crypto.randomUUID(),
        timestamp: Date.now()
      };
      setScanResult(finalResult);
      await saveToHistory(finalResult);
      setStatus('result');
    } catch (error) {
      console.error("AI Analysis failed:", error);
      alert("Failed to analyze ingredients. Please try again.");
      setStatus('editing');
    }
  };

  // --- Camera Logic ---
  const startCamera = async () => {
    if (activeTab !== 'scan') return;
    
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
    } catch (err) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (innerErr) {
        console.error("All camera access failed:", innerErr);
        setCameraError("Camera access denied.");
        return;
      }
    }

    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      setCameraError(null);
      setCapturedImage(null);
    }
    return stream;
  };

  useEffect(() => {
    let currentStream: MediaStream | null = null;
    const init = async () => {
      currentStream = await startCamera();
    };
    init();
    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [activeTab]);

  const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const getCroppedImg = async () => {
    if (!capturedImage || !croppedAreaPixels) return null;
    
    const image = new Image();
    image.src = capturedImage;
    await new Promise(resolve => image.onload = resolve);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = croppedAreaPixels.width;
    canvas.height = croppedAreaPixels.height;

    ctx.drawImage(
      image,
      croppedAreaPixels.x,
      croppedAreaPixels.y,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
      0,
      0,
      croppedAreaPixels.width,
      croppedAreaPixels.height
    );

    return canvas.toDataURL('image/jpeg');
  };

  const handleScan = async () => {
    let imageToDetect = capturedImage;

    if (!imageToDetect && videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        imageToDetect = canvas.toDataURL('image/jpeg');
        setCapturedImage(imageToDetect);
      }
    }

    if (imageToDetect) {
      await autoDetectLabel(imageToDetect);
    } else {
      alert("No image to scan. Please point your camera or upload a photo.");
    }
  };

  const handleConfirmCrop = async () => {
    const cropped = await getCroppedImg();
    if (cropped) {
      setCroppedImage(cropped);
      await extractIngredients(cropped);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCapturedImage(reader.result as string);
        setCameraError(null);
        handleScan();
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const closeResult = () => {
    setStatus('idle');
    setExpandedIdx(null);
  };

  const toggleExpand = (idx: number) => {
    setExpandedIdx(expandedIdx === idx ? null : idx);
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-off-white overflow-hidden relative">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-healthy-green rounded-lg flex items-center justify-center">
            <Scan className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">PureScan</h1>
        </div>
        <button className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <Info className="w-5 h-5 text-gray-500" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-24">
        {activeTab === 'scan' && (
          <div className="p-6 space-y-8">
            {/* Camera Viewfinder & Workflow Screens */}
            <div className="relative aspect-[3/4] bg-black rounded-3xl overflow-hidden shadow-2xl group">
              {/* Hidden File Input */}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept="image/*" 
                className="hidden" 
              />

              {/* Hidden Canvas for Frame Capture */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Viewfinder Content */}
              <AnimatePresence mode="wait">
                {status === 'idle' && (
                  <motion.div 
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full"
                  >
                    {capturedImage ? (
                      <div className="relative w-full h-full">
                        <img 
                          src={capturedImage} 
                          alt="Captured" 
                          className="w-full h-full object-cover"
                        />
                        <button 
                          onClick={() => {
                            setCapturedImage(null);
                            setCameraError(null);
                            startCamera();
                          }}
                          className="absolute top-4 right-4 p-2 bg-black/50 backdrop-blur-md text-white rounded-full hover:bg-black/70 transition-colors"
                        >
                          <RefreshCw className="w-5 h-5" />
                        </button>
                      </div>
                    ) : cameraError ? (
                      <div className="w-full h-full flex flex-col items-center justify-center text-white/60 p-8 text-center space-y-6">
                        <div className="space-y-2">
                          <CameraOff className="w-12 h-12 mx-auto text-critical-red" />
                          <h3 className="text-white font-bold">Camera Access Denied</h3>
                          <p className="text-xs leading-relaxed opacity-80">
                            We couldn't access your camera. You can still scan by uploading a photo.
                          </p>
                        </div>

                        <div className="flex flex-col gap-3 w-full max-w-[200px]">
                          <button 
                            onClick={triggerFileUpload}
                            className="px-4 py-3 bg-white text-gray-900 rounded-2xl text-xs font-bold shadow-lg active:scale-95 transition-all"
                          >
                            UPLOAD PHOTO
                          </button>
                          <button 
                            onClick={() => startCamera()}
                            className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl text-xs font-bold border border-white/20 transition-all"
                          >
                            RETRY CAMERA
                          </button>
                        </div>

                        <div className="pt-4 border-t border-white/10 w-full">
                          <p className="text-[10px] uppercase tracking-widest font-bold mb-2 opacity-50">Troubleshooting</p>
                          <ul className="text-[10px] text-left space-y-1 opacity-70 list-disc pl-4">
                            <li>Click the <b>Lock icon</b> in your address bar</li>
                            <li>Ensure <b>Camera</b> is set to "Allow"</li>
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <video 
                        ref={videoRef}
                        autoPlay 
                        playsInline 
                        muted 
                        className="w-full h-full object-cover"
                      />
                    )}
                  </motion.div>
                )}

                {status === 'cropping' && capturedImage && (
                  <motion.div 
                    key="cropping"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full relative bg-gray-900"
                  >
                    <Cropper
                      image={capturedImage}
                      crop={crop}
                      zoom={zoom}
                      aspect={3 / 4}
                      onCropChange={setCrop}
                      onCropComplete={onCropComplete}
                      onZoomChange={setZoom}
                    />
                    <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4 px-6">
                      <button 
                        onClick={() => setStatus('idle')}
                        className="flex-1 py-3 bg-white/10 backdrop-blur-md text-white rounded-2xl font-bold border border-white/20"
                      >
                        CANCEL
                      </button>
                      <button 
                        onClick={handleConfirmCrop}
                        className="flex-1 py-3 bg-healthy-green text-white rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2"
                      >
                        <CropIcon className="w-4 h-4" />
                        CONFIRM CROP
                      </button>
                    </div>
                    <div className="absolute top-6 left-0 right-0 text-center">
                      <span className="bg-black/50 backdrop-blur-md text-white px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest">
                        Crop to Nutrition Label & Ingredients
                      </span>
                    </div>
                  </motion.div>
                )}

                {(status === 'detecting' || status === 'extracting' || status === 'analyzing') && (
                  <motion.div 
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col items-center justify-center bg-gray-900 text-white p-8 space-y-6"
                  >
                    <div className="relative">
                      <div className="w-24 h-24 border-4 border-healthy-green/20 rounded-full animate-pulse" />
                      <Loader2 className="w-12 h-12 text-healthy-green animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <div className="text-center space-y-2">
                      <h3 className="text-xl font-bold">
                        {status === 'detecting' ? 'Auto-detecting Label...' : 
                         status === 'extracting' ? 'Detecting Ingredients...' : 'Analyzing Health Risks...'}
                      </h3>
                      <p className="text-sm text-white/60">
                        {status === 'detecting' ? 'Finding the nutrition facts area' :
                         status === 'extracting' ? 'Our AI is reading the label text' : 'Checking for risky additives'}
                      </p>
                    </div>
                  </motion.div>
                )}

                {status === 'editing' && (
                  <motion.div 
                    key="editing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col bg-white p-6 space-y-4"
                  >
                    <div className="flex items-center gap-2 text-healthy-green">
                      <Edit3 className="w-5 h-5" />
                      <h3 className="font-bold">Manual Edit Option</h3>
                    </div>
                    <p className="text-xs text-gray-500">
                      We detected these ingredients. Please fix any errors before final analysis.
                    </p>
                    <textarea 
                      value={extractedIngredients}
                      onChange={(e) => setExtractedIngredients(e.target.value)}
                      className="flex-1 w-full p-4 bg-gray-50 rounded-2xl border border-gray-200 text-sm focus:ring-2 focus:ring-healthy-green/20 focus:border-healthy-green outline-none resize-none font-mono"
                      placeholder="Enter ingredients list here..."
                    />
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setStatus('cropping')}
                        className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-2xl font-bold"
                      >
                        BACK
                      </button>
                      <button 
                        onClick={() => analyzeIngredients(extractedIngredients)}
                        className="flex-[2] py-3 bg-healthy-green text-white rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        ANALYZE NOW
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              {/* Scan Frame Overlay (Only in idle) */}
              {status === 'idle' && !capturedImage && !cameraError && (
                <div className="absolute inset-0 flex items-center justify-center p-12 pointer-events-none">
                  <div className="w-full h-full border-2 border-white/40 rounded-2xl relative">
                    {/* Corner Accents */}
                    <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-healthy-green rounded-tl-lg" />
                    <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-healthy-green rounded-tr-lg" />
                    <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-healthy-green rounded-bl-lg" />
                    <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-healthy-green rounded-br-lg" />
                  </div>
                </div>
              )}

              {/* Scan Button Overlay (Only in idle) */}
              {status === 'idle' && (
                <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-4">
                  <div className="flex flex-col items-center gap-3">
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleScan}
                      className="bg-healthy-green text-white px-8 py-4 rounded-full font-bold shadow-xl flex items-center gap-3 hover:bg-green-800 transition-colors"
                    >
                      <Scan className="w-6 h-6" />
                      SCAN PRODUCT
                    </motion.button>
                    
                    {!cameraError && (
                      <button 
                        onClick={triggerFileUpload}
                        className="text-white/80 text-[10px] font-bold uppercase tracking-widest hover:text-white transition-colors"
                      >
                        Or Upload Photo
                      </button>
                    )}
                  </div>
                  <p className="text-white/70 text-[10px] font-medium uppercase tracking-widest">Point at nutrition label</p>
                </div>
              )}
            </div>

            {/* Learn More Section */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900">Learn More</h2>
                <button className="text-healthy-green text-sm font-semibold flex items-center">
                  View All <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6 no-scrollbar">
                {YOUTUBE_VIDEOS.map((video) => (
                  <motion.div 
                    key={video.id}
                    whileHover={{ y: -4 }}
                    className="flex-shrink-0 w-64 bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100"
                  >
                    <div className="relative aspect-video">
                      <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                        <div className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                          <Play className="w-5 h-5 text-healthy-green fill-healthy-green" />
                        </div>
                      </div>
                    </div>
                    <div className="p-3">
                      <h3 className="text-sm font-semibold text-gray-800 line-clamp-2">{video.title}</h3>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Scan History</h2>
              {history.length > 0 && (
                <button 
                  onClick={() => {
                    if (confirm("Clear all history?")) {
                      setHistory([]);
                    }
                  }}
                  className="text-xs font-bold text-critical-red uppercase tracking-widest"
                >
                  Clear All
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
                  <History className="w-10 h-10 text-gray-400" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">No History Yet</h2>
                <p className="text-gray-500 max-w-[240px]">Your scanned products will appear here for quick reference.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {history.map((item) => (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => {
                      setScanResult(item);
                      setStatus('result');
                    }}
                    className="w-full flex items-center gap-4 p-4 bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all text-left"
                  >
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white text-xl shrink-0 ${
                      item.grade === 'A' ? 'bg-emerald-500' :
                      item.grade === 'B' ? 'bg-lime-500' :
                      item.grade === 'C' ? 'bg-amber-500' :
                      item.grade === 'D' ? 'bg-orange-500' : 'bg-red-500'
                    }`}>
                      {item.grade}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-900 truncate">{item.productName}</h3>
                      <p className="text-xs text-gray-500">
                        {new Date(item.timestamp).toLocaleDateString()} • {item.riskyIngredients.length} Risks
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300" />
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="p-6 space-y-6">
            {!showProfile ? (
              <>
                <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
                <div className="space-y-2">
                  {['Profile', 'Dietary Preferences', 'Privacy Policy'].map((item) => (
                    <button 
                      key={item} 
                      onClick={() => item === 'Profile' && setShowProfile(true)}
                      className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <span className="font-medium text-gray-700">{item}</span>
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-8">
                {/* Profile Header */}
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setShowProfile(false)}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <ChevronDown className="w-6 h-6 rotate-90" />
                  </button>
                  <h2 className="text-2xl font-bold text-gray-900">Identity Hub</h2>
                </div>

                {/* Avatar Section */}
                <div className="flex flex-col items-center space-y-4">
                  <div className="relative">
                    <div className="w-32 h-32 rounded-full bg-healthy-green/10 border-4 border-white shadow-xl flex items-center justify-center overflow-hidden">
                      <img 
                        src={user?.user_metadata?.avatar_url || "https://picsum.photos/seed/user/200/200"} 
                        alt="User Avatar" 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 bg-healthy-green rounded-full border-4 border-white flex items-center justify-center shadow-lg">
                      <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    </div>
                  </div>
                  <div className="text-center">
                    <h3 className="text-xl font-bold text-gray-900">{user?.user_metadata?.full_name || user?.email || "[User Name]"}</h3>
                    <p className="text-sm text-gray-500 font-medium">{user?.email || "pk.piyushkumar.9123@gmail.com"}</p>
                  </div>
                </div>

                {/* Data Points */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm space-y-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Member Since</p>
                    <p className="font-bold text-gray-900">
                      {user ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : "March 2026"}
                    </p>
                  </div>
                  <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm space-y-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Scans</p>
                    <p className="font-bold text-gray-900">{history.length}</p>
                  </div>
                </div>

                {/* Social Login Section */}
                <div className="space-y-4">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center">
                    {user ? "Connected Accounts" : "Sign in to sync data"}
                  </p>
                  <div className="flex justify-center gap-6">
                    {/* Google */}
                    <button 
                      onClick={() => handleSocialLogin('google')}
                      className="w-14 h-14 bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center hover:bg-gray-50 transition-all active:scale-95"
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    </button>
                    {/* Facebook */}
                    <button 
                      onClick={() => handleSocialLogin('facebook')}
                      className="w-14 h-14 bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center hover:bg-gray-50 transition-all active:scale-95"
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24">
                        <path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                    </button>
                    {/* Apple */}
                    <button 
                      onClick={() => handleSocialLogin('apple')}
                      className="w-14 h-14 bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center hover:bg-gray-50 transition-all active:scale-95"
                    >
                      <svg className="w-6 h-6" viewBox="0 0 24 24">
                        <path fill="#000000" d="M17.057 10.78c-.045-2.184 1.782-3.232 1.864-3.282-1.014-1.482-2.587-1.684-3.143-1.708-1.334-.136-2.603.786-3.278.786-.676 0-1.72-.767-2.83-.745-1.458.022-2.803.85-3.553 2.153-1.514 2.628-.387 6.52 1.083 8.643.72 1.04 1.575 2.208 2.701 2.166 1.084-.042 1.492-.7 2.803-.7s1.676.7 2.825.678c1.17-.022 1.917-1.05 2.63-2.093.824-1.206 1.165-2.373 1.184-2.433-.025-.011-2.28-.874-2.306-3.468zM14.53 3.988c.6-.727 1.005-1.738.894-2.748-.868.035-1.92.578-2.542 1.305-.558.646-1.045 1.678-.915 2.667.968.075 1.963-.497 2.563-1.224z"/>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Logout Button */}
                <button 
                  onClick={handleLogout}
                  className="w-full py-4 bg-red-50 text-critical-red rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-red-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                  LOG OUT
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Result Card (Bottom Sheet) */}
      <AnimatePresence>
        {status === 'result' && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeResult}
              className="absolute inset-0 bg-black/40 z-20"
            />
            
            {/* Sheet */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-[40px] z-30 shadow-2xl max-h-[90%] overflow-y-auto"
            >
              {/* Handle */}
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mt-4 mb-2" />
              
              <div className="p-8 space-y-8">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{scanResult?.productName || "Unknown Product"}</h2>
                    <p className="text-gray-500 font-medium">Analyzed Result</p>
                  </div>
                  <button 
                    onClick={closeResult}
                    className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-600" />
                  </button>
                </div>

                {/* Score Section */}
                <div className="flex items-center gap-8 bg-gray-50 p-6 rounded-3xl">
                  {scanResult && <CircularProgress score={scanResult.score} grade={scanResult.grade} />}
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-gray-900">Health Score</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {scanResult?.grade === 'A' || scanResult?.grade === 'B' 
                        ? "This product is generally healthy and safe for consumption."
                        : "This product contains several ingredients linked to health risks."}
                    </p>
                  </div>
                </div>

                {/* Risk List */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <AlertCircle className={`w-5 h-5 ${scanResult?.riskyIngredients.length ? 'text-critical-red' : 'text-healthy-green'}`} />
                    {scanResult?.riskyIngredients.length ? 'Risk List' : 'No Major Risks Found'}
                  </h3>
                  <div className="space-y-3">
                    {scanResult?.riskyIngredients.map((ing, idx) => (
                      <div 
                        key={idx} 
                        className={`flex flex-col p-4 bg-red-50 rounded-2xl border border-red-100 transition-all duration-300 ${expandedIdx === idx ? 'ring-2 ring-critical-red/20' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex gap-4">
                            <div className="mt-1">
                              <div className={`w-2 h-2 rounded-full ${ing.risk === 'high' ? 'bg-critical-red' : 'bg-warning-amber'}`} />
                            </div>
                            <div>
                              <h4 className="font-bold text-critical-red">{ing.name}</h4>
                              <p className="text-xs text-red-700/80 mt-1">{ing.description}</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => toggleExpand(idx)}
                            className={`p-2 rounded-full transition-colors ${expandedIdx === idx ? 'bg-critical-red text-white' : 'bg-white text-gray-400 hover:text-critical-red'}`}
                          >
                            <Info className="w-4 h-4" />
                          </button>
                        </div>
                        
                        <AnimatePresence>
                          {expandedIdx === idx && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="pt-4 mt-4 border-t border-red-200/50">
                                <h5 className="text-[10px] font-bold uppercase tracking-wider text-red-800 mb-2">Health Implications</h5>
                                <p className="text-sm text-red-900 leading-relaxed">
                                  {ing.implications}
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Better Alternative */}
                {scanResult?.alternative && (
                  <div className="bg-healthy-green/5 p-6 rounded-3xl border border-healthy-green/10 space-y-3">
                    <h3 className="text-lg font-bold text-healthy-green flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      Better Alternative
                    </h3>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-gray-900">{scanResult.alternative.name}</h4>
                        <p className="text-sm text-gray-600">{scanResult.alternative.reason}</p>
                      </div>
                      <button className="p-3 bg-healthy-green text-white rounded-2xl shadow-lg shadow-green-900/20">
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button 
                    onClick={() => setStatus('editing')}
                    className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                    EDIT
                  </button>
                  <button 
                    onClick={closeResult}
                    className="flex-[2] py-4 bg-gray-900 text-white rounded-2xl font-bold shadow-xl active:scale-[0.98] transition-transform"
                  >
                    GOT IT
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-gray-100 px-8 py-4 flex items-center justify-between z-10 max-w-md mx-auto">
        <NavButton 
          active={activeTab === 'scan'} 
          onClick={() => setActiveTab('scan')} 
          icon={<Scan className="w-6 h-6" />} 
          label="Scan" 
        />
        <NavButton 
          active={activeTab === 'history'} 
          onClick={() => setActiveTab('history')} 
          icon={<History className="w-6 h-6" />} 
          label="History" 
        />
        <NavButton 
          active={activeTab === 'settings'} 
          onClick={() => setActiveTab('settings')} 
          icon={<Settings className="w-6 h-6" />} 
          label="Settings" 
        />
      </nav>

      {/* Custom Scrollbar Styles */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-all duration-300 ${active ? 'text-healthy-green scale-110' : 'text-gray-400'}`}
    >
      <div className={`p-1 rounded-xl transition-colors ${active ? 'bg-healthy-green/10' : ''}`}>
        {icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      {active && (
        <motion.div 
          layoutId="nav-indicator"
          className="w-1 h-1 bg-healthy-green rounded-full"
        />
      )}
    </button>
  );
}
