import { db, storage } from '../config/firebase';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export const FirebaseService = {
    // Tạo phiên chụp mới
    createSession: async (sessionData) => {
        try {
            const docRef = await addDoc(collection(db, 'sessions'), {
                ...sessionData,
                createdAt: serverTimestamp(),
                status: 'pending',
                photos: {
                    raw: [],
                    final: null
                }
            });
            return docRef.id;
        } catch (error) {
            console.error("Error creating session: ", error);
            throw error;
        }
    },

    // Cập nhật trạng thái thanh toán
    updatePayment: async (sessionId, paymentData) => {
        try {
            const sessionRef = doc(db, 'sessions', sessionId);
            await updateDoc(sessionRef, {
                payment: {
                    ...paymentData,
                    status: 'paid', // Giả sử gọi hàm này là đã thanh toán thành công
                    paidAt: serverTimestamp()
                }
            });
        } catch (error) {
            console.error("Error updating payment: ", error);
            throw error;
        }
    },

    // Upload ảnh lên Storage
    uploadPhoto: async (sessionId, photoBlob, fileName, folder = 'raw') => {
        try {
            const storageRef = ref(storage, `sessions/${sessionId}/${folder}/${fileName}`);
            await uploadBytes(storageRef, photoBlob);
            const downloadURL = await getDownloadURL(storageRef);
            return downloadURL;
        } catch (error) {
            console.error("Error uploading photo: ", error);
            throw error;
        }
    },

    // Cập nhật link ảnh vào Firestore
    savePhotoLinks: async (sessionId, photoUrls, type = 'raw') => {
        try {
            const sessionRef = doc(db, 'sessions', sessionId);
            const updateData = type === 'final'
                ? { 'photos.final': photoUrls }
                : { 'photos.raw': photoUrls };

            await updateDoc(sessionRef, updateData);
        } catch (error) {
            console.error("Error saving photo links: ", error);
            throw error;
        }
    }
};
