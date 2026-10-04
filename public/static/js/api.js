// PlantGuard API client — thin wrapper around axios for every backend call.
// Centralizing endpoints here means route/shape changes only need updates
// in one place (Phase 26: frontend architecture).

axios.defaults.withCredentials = true;

function unwrapError(e) {
  const data = e?.response?.data;
  if (data && typeof data === 'object') return data;
  return { error: e?.message || 'Network error. Please check your connection and try again.' };
}

export const api = {
  // ---- Diagnosis ----
  async analyzeLeaf(file, cnnResult) {
    const formData = new FormData();
    formData.append('image', file);
    // Optional on-device CNN prediction: when the browser model is confident,
    // the server skips the vision-LLM call. Absent -> legacy LLM path.
    if (cnnResult && cnnResult.label && Number.isFinite(cnnResult.confidence)) {
      formData.append('cnn_prediction', cnnResult.label);
      formData.append('cnn_confidence', String(cnnResult.confidence));
    }
    try {
      const { data } = await axios.post('/api/diagnosis/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, status: e?.response?.status, data: unwrapError(e) };
    }
  },
  async getHistory(params = {}) {
    try {
      const { data } = await axios.get('/api/diagnosis/history', { params });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async getHistoryItem(id) {
    try {
      const { data } = await axios.get(`/api/diagnosis/history/${id}`);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async deleteHistoryItem(id) {
    try {
      await axios.delete(`/api/diagnosis/history/${id}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async sendDiagnosisFeedback(id, feedback) {
    try {
      await axios.post(`/api/diagnosis/${id}/feedback`, { feedback });
      return { ok: true };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },

  // ---- Chat ----
  async getChatHistory() {
    try {
      const { data } = await axios.get('/api/chat/history');
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async sendChatMessage(message, diagnosisId) {
    try {
      const payload = { message };
      if (diagnosisId) payload.diagnosis_id = diagnosisId;
      const { data } = await axios.post('/api/chat/send', payload);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, status: e?.response?.status, data: unwrapError(e) };
    }
  },
  async clearChatHistory() {
    try {
      await axios.delete('/api/chat/history');
      return { ok: true };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async sendChatFeedback(id, feedback) {
    try {
      await axios.post(`/api/chat/${id}/feedback`, { feedback });
      return { ok: true };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },

  // ---- Community ----
  async getPosts(params = {}) {
    try {
      const { data } = await axios.get('/api/community/posts', { params });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async createPost(payload) {
    try {
      const { data } = await axios.post('/api/community/posts', payload);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async updatePost(id, payload) {
    try {
      const { data } = await axios.put(`/api/community/posts/${id}`, payload);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async deletePost(id) {
    try {
      await axios.delete(`/api/community/posts/${id}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async toggleLike(id) {
    try {
      const { data } = await axios.post(`/api/community/posts/${id}/like`);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async submitComment(id, payload) {
    try {
      await axios.post(`/api/community/posts/${id}/comments`, payload);
      return { ok: true };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },

  // ---- Library ----
  async getDiseases() {
    try {
      const { data } = await axios.get('/api/library/diseases');
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async getPlants() {
    try {
      const { data } = await axios.get('/api/library/plants');
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async getDiseaseInfo(name) {
    try {
      const { data } = await axios.get('/api/library/disease', { params: { name } });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, status: e?.response?.status, data: unwrapError(e) };
    }
  },
  async getCultivationGuide(plant) {
    try {
      const { data } = await axios.get('/api/library/cultivation', { params: { plant } });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, status: e?.response?.status, data: unwrapError(e) };
    }
  },

  // ---- Weather ----
  async detectLocation() {
    try {
      const { data } = await axios.get('/api/weather/detect');
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async getForecast(params = {}) {
    try {
      const { data } = await axios.get('/api/weather/forecast', { params });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },
  async getRiskSummary() {
    try {
      const { data } = await axios.get('/api/weather/risk-summary');
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  },

  // ---- Admin / health ----
  async getHealth() {
    try {
      const { data } = await axios.get('/api/admin/health');
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: unwrapError(e) };
    }
  }
};
