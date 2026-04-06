const state = {
  image: null,
  imageLoaded: false,
  boardSize: 19,
  boardSizeMode: "auto",
  corners: [],
  cvReady: false,
  warpedImageData: null,
  activeCorners: [],
  cropMode: false,
  cropRect: null,
  cropDragStart: null,
  isCropping: false,
  shiftX: 0,
  shiftY: 0,
  rotation: 0,
  editTool: "erase",
  manualEdits: {},
  hoverPoint: null,
  mappingContext: null,
  lastDetectionMeta: null,
  rawStones: [],
  stones: [],
  extracting: false,
  detectionMode: "preprocessed",
  showImagePreview: false,
  warpPreviewCanvas: null,
  gridLayerCanvas: null,
  stoneLayerCanvas: null,
  imageProcessingMeta: null,
  autoProcessPending: false,
  boardSizeInference: null,
  detectionDebug: null,
  detectionDebugFrameIndex: -1,
  detectionDebugTimer: null,
};

const sourceCanvas = document.getElementById("sourceCanvas");
const sourceCtx = sourceCanvas.getContext("2d");
const warpCanvas = document.getElementById("warpCanvas");
const warpCtx = warpCanvas.getContext("2d");
const gridLayerCanvas = document.getElementById("gridLayerCanvas");
const gridLayerCtx = gridLayerCanvas.getContext("2d");
const stoneLayerCanvas = document.getElementById("stoneLayerCanvas");
const stoneLayerCtx = stoneLayerCanvas.getContext("2d");
const sgfPreviewCanvas = document.getElementById("sgfPreviewCanvas");
const sgfPreviewCtx = sgfPreviewCanvas.getContext("2d");

const imageInput = document.getElementById("imageInput");
const pasteZone = document.getElementById("pasteZone");
const boardSizeSelect = document.getElementById("boardSizeSelect");
const autoCornersBtn = document.getElementById("autoCornersBtn");
const replayDetectionBtn = document.getElementById("replayDetectionBtn");
const resetCornersBtn = document.getElementById("resetCornersBtn");
const cropModeBtn = document.getElementById("cropModeBtn");
const applyCropBtn = document.getElementById("applyCropBtn");
const cancelCropBtn = document.getElementById("cancelCropBtn");
const extractBtn = document.getElementById("extractBtn");
const blackThresholdInput = document.getElementById("blackThresholdInput");
const whiteThresholdInput = document.getElementById("whiteThresholdInput");
const autoBalanceCheckbox = document.getElementById("autoBalanceCheckbox");
const autoBalanceSpinner = document.getElementById("autoBalanceSpinner");
const detectionModeSelect = document.getElementById("detectionModeSelect");
const generateBtn = document.getElementById("generateBtn");
const downloadBtn = document.getElementById("downloadBtn");

const cornerStatus = document.getElementById("cornerStatus");
const detectionDebugStatus = document.getElementById("detectionDebugStatus");
const extractStatus = document.getElementById("extractStatus");
const sgfStatus = document.getElementById("sgfStatus");
const sgfOutput = document.getElementById("sgfOutput");
const gameNameInput = document.getElementById("gameName");
const komiInput = document.getElementById("komiInput");
const nextPlayerSelect = document.getElementById("nextPlayerSelect");
const toolBlackBtn = document.getElementById("toolBlackBtn");
const toolWhiteBtn = document.getElementById("toolWhiteBtn");
const toolEraseBtn = document.getElementById("toolEraseBtn");
const showImageBtn = document.getElementById("showImageBtn");
const editToolStatus = document.getElementById("editToolStatus");
const shiftUpBtn = document.getElementById("shiftUpBtn");
const shiftDownBtn = document.getElementById("shiftDownBtn");
const shiftLeftBtn = document.getElementById("shiftLeftBtn");
const shiftRightBtn = document.getElementById("shiftRightBtn");
const rotateBtn = document.getElementById("rotateBtn");
const shiftValue = document.getElementById("shiftValue");

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const DEFAULT_BLACK_THRESHOLD = 26;
const DEFAULT_WHITE_THRESHOLD = 22;
