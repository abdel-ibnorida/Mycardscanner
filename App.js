import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
  Image,
  Dimensions,
  TextInput,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import goatCards from './assets/goat.json';

const OCR_API_KEY = 'K86494140488957';

const screenWidth = Dimensions.get('window').width;
const screenHeight = Dimensions.get('window').height;

const RECT_WIDTH = screenWidth * 0.5;
const RECT_HEIGHT = screenHeight * 0.05;
const RECT_LEFT = (screenWidth - RECT_WIDTH) / 2;
const RECT_TOP = (screenHeight - RECT_HEIGHT) / 2;

export default function App() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facing, setFacing] = useState('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState(null);
  const [croppedUri, setCroppedUri] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [cardInfo, setCardInfo] = useState(null);
  const [manualIdInputVisible, setManualIdInputVisible] = useState(false);
  const [manualId, setManualId] = useState('');
  const cameraRef = useRef(null);

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text>Loading permissions...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text>We need your permission to show the camera</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function toggleCamera() {
    setFacing(facing === 'back' ? 'front' : 'back');
  }

  async function compressImage(uri) {
    let compressedUri = uri;
    let fileInfo = await FileSystem.getInfoAsync(compressedUri);
    let quality = 0.9;
    let width = 1080;

    while (fileInfo.size > 1024 * 1024 && quality > 0.1) {
      const manipResult = await ImageManipulator.manipulateAsync(
        compressedUri,
        [{ resize: { width } }],
        { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
      );
      compressedUri = manipResult.uri;
      fileInfo = await FileSystem.getInfoAsync(compressedUri);
      quality -= 0.1;
      width = Math.floor(width * 0.9);
    }
    return compressedUri;
  }

  async function takePicture() {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync();
        let photoUri = photo.uri;

        let fileInfo = await FileSystem.getInfoAsync(photoUri);
        if (!fileInfo.exists) {
          Alert.alert('Errore', 'Impossibile leggere il file.');
          return;
        }

        if (fileInfo.size > 1024 * 1024) {
          photoUri = await compressImage(photoUri);
          fileInfo = await FileSystem.getInfoAsync(photoUri);

          if (fileInfo.size > 1024 * 1024) {
            Alert.alert('Errore', "Impossibile comprimere l'immagine sotto 1MB.");
            return;
          }
        }

        const manipResult = await ImageManipulator.manipulateAsync(photoUri, []);
        const imageWidth = manipResult.width;
        const imageHeight = manipResult.height;

        const widthRatio = imageWidth / screenWidth;
        const heightRatio = imageHeight / screenHeight;

        const cropX = RECT_LEFT * widthRatio;
        const cropY = RECT_TOP * heightRatio;
        const cropWidth = RECT_WIDTH * widthRatio;
        const cropHeight = RECT_HEIGHT * heightRatio;

        const cropped = await ImageManipulator.manipulateAsync(
          photoUri,
          [{ crop: { originX: cropX, originY: cropY, width: cropWidth, height: cropHeight } }],
          { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
        );

        setCroppedUri(cropped.uri);
        setModalVisible(true);
      } catch (error) {
        Alert.alert('Errore', 'Errore durante lo scatto: ' + error.message);
      }
    }
  }

  async function sendCroppedToOCR() {
    setLoading(true);
    setModalVisible(false);

    try {
      const base64 = await FileSystem.readAsStringAsync(croppedUri, { encoding: 'base64' });

      const formData = new FormData();
      formData.append('base64Image', 'data:image/jpeg;base64,' + base64);
      formData.append('language', 'eng');
      formData.append('isOverlayRequired', 'false');

      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: {
          apikey: OCR_API_KEY,
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      const result = await response.json();
      setLoading(false);

      if (result.IsErroredOnProcessing) {
        Alert.alert('OCR Error', result.ErrorMessage.join('\n'));
        return;
      }

      const text = result.ParsedResults[0].ParsedText.trim();
      const numericId = text.replace(/\D/g, '');
      if (numericId.length === 0) {
        Alert.alert('Errore OCR', 'ID non rilevato o non valido.');
        return;
      }

      fetchCardInfo(numericId);
    } catch (error) {
      setLoading(false);
      Alert.alert('Errore', error.message);
    }
  }

  async function fetchCardInfo(id) {
    try {
      setLoading(true);

      const [resEng, resIt] = await Promise.all([
        fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${id}`),
        fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${id}&language=it`),
      ]);

      const jsonEng = await resEng.json();
      const jsonIt = await resIt.json();

      if (!jsonEng.data || !jsonIt.data) {
        Alert.alert('Errore', 'Carta non trovata.');
        setLoading(false);
        return;
      }

      const cardEng = jsonEng.data[0];
      const cardIt = jsonIt.data[0];
      const price = cardEng.card_prices?.[0]?.cardmarket_price || 'N/A';
      const imageUrl = cardEng.card_images?.[0]?.image_url || '';

      const isGoat = goatCards.some((card) => {
        const numericId = Number(id);
        return card.id === numericId || card.id_images.includes(numericId);
        });


     
      setCardInfo({
        id,
        nameEng: cardEng.name,
        nameIt: cardIt.name,
        price,
        imageUrl,
        goatFormat: isGoat ? 'Si' : 'No',
      });

      setCameraOpen(false);
      setCroppedUri(null);
      setOcrResult(null);
      setLoading(false);
    } catch (error) {
      setLoading(false);
      Alert.alert('Errore', error.message);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0066cc" />
        <Text style={{ marginTop: 10 }}>Elaborazione...</Text>
      </View>
    );
  }

  if (cardInfo) {
    return (
      <ScrollView contentContainerStyle={styles.center}>
        <Text style={styles.ocrText}>ID: {cardInfo.id}</Text>
        <Text style={styles.ocrText}>Nome (IT): {cardInfo.nameIt}</Text>
        <Text style={styles.ocrText}>Nome (EN): {cardInfo.nameEng}</Text>
        <Text style={styles.ocrText}>Prezzo Cardmarket: €{cardInfo.price}</Text>
        <Text style={[styles.ocrText, { fontWeight: 'bold' }]}>Goat Format: {cardInfo.goatFormat}</Text>
        <Image source={{ uri: cardInfo.imageUrl }} style={{ width: 200, height: 300, marginVertical: 20 }} />
        <TouchableOpacity style={styles.button} onPress={() => setCardInfo(null)}>
          <Text style={styles.buttonText}>Torna indietro</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      {!cameraOpen ? (
        <View style={styles.center}>
          <TouchableOpacity style={styles.openButton} onPress={() => setCameraOpen(true)}>
            <Text style={styles.buttonText}>Apri Fotocamera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.openButton, { backgroundColor: '#28a745' }]}
            onPress={() => setManualIdInputVisible(true)}
          >
            <Text style={styles.buttonText}>Inserisci ID manualmente</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <CameraView style={styles.camera} facing={facing} ref={cameraRef} />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: RECT_TOP,
              left: RECT_LEFT,
              width: RECT_WIDTH,
              height: RECT_HEIGHT,
              borderWidth: 2,
              borderColor: 'white',
              borderRadius: 10,
            }}
          />
          <View style={styles.controls}>
            <TouchableOpacity style={styles.controlButton} onPress={toggleCamera}>
              <Text style={styles.buttonText}>Flip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={takePicture}>
              <Text style={styles.buttonText}>Scatta</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={() => setCameraOpen(false)}>
              <Text style={styles.buttonText}>Chiudi</Text>
            </TouchableOpacity>
          </View>
          <Modal visible={modalVisible} transparent={false} animationType="slide">
            <View style={styles.center}>
              {croppedUri ? (
                <>
                  <Image
                    source={{ uri: croppedUri }}
                    style={{ width: RECT_WIDTH, height: RECT_HEIGHT, marginBottom: 20 }}
                    resizeMode="contain"
                  />
                  <TouchableOpacity style={styles.button} onPress={sendCroppedToOCR}>
                    <Text style={styles.buttonText}>Usa questa immagine</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, { backgroundColor: 'gray' }]}
                    onPress={() => setModalVisible(false)}
                  >
                    <Text style={styles.buttonText}>Ritenta</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <ActivityIndicator size="large" color="#0066cc" />
              )}
            </View>
          </Modal>
        </>
      )}
      <Modal visible={manualIdInputVisible} transparent animationType="slide">
        <View style={styles.center}>
          <Text style={{ fontSize: 18, marginBottom: 10 }}>Inserisci l'ID della carta</Text>
          <TextInput
            style={styles.input}
            placeholder="Es. 46986414"
            keyboardType="numeric"
            value={manualId}
            onChangeText={setManualId}
          />
          <TouchableOpacity
            style={styles.button}
            onPress={() => {
              setManualIdInputVisible(false);
              fetchCardInfo(manualId);
            }}
          >
            <Text style={styles.buttonText}>Cerca</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: 'gray' }]}
            onPress={() => setManualIdInputVisible(false)}
          >
            <Text style={styles.buttonText}>Annulla</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  openButton: {
    backgroundColor: '#0066cc',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  button: {
    marginTop: 20,
    backgroundColor: '#0066cc',
    padding: 15,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
    textAlign: 'center',
  },
  camera: {
    flex: 1,
  },
  controls: {
    position: 'absolute',
    bottom: 30,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  controlButton: {
    backgroundColor: '#0066cc',
    padding: 15,
    borderRadius: 10,
  },
  ocrText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 10,
  },
  input: {
    height: 50,
    width: '80%',
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 15,
    backgroundColor: 'white',
    marginBottom: 15,
  },
});
