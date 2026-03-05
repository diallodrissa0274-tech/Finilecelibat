// ============================================
// FINILECELIBAT — backend.js
// Colle ce fichier dans ton projet
// Remplace les valeurs SUPABASE_URL et SUPABASE_KEY
// ============================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ── CONFIG (à remplacer avec tes vraies clés Supabase) ──
const SUPABASE_URL = 'https://jdvmrlutysporgaxsrrs.supabase.co';  // ← ton URL Supabase
const SUPABASE_KEY = 'sb_publishable_big7CLf15TgRr2Jwd58fRg_q1Pjni6u';   // ← ta clé publique (anon key)

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


// ════════════════════════════════════════════
// 1. AUTHENTIFICATION
// ════════════════════════════════════════════

/**
 * Inscription d'un nouvel utilisateur
 * @param {string} email
 * @param {string} password
 * @param {object} profil - { prenom, age, sexe, ville, telephone }
 */
export async function inscrire(email, password, profil) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: profil  // Ces données sont passées au trigger pour créer le profil
    }
  });

  if (error) throw error;

  // Créer l'essai gratuit de 1 jour
  if (data.user) {
    await supabase.rpc('creer_essai_gratuit', { user_uuid: data.user.id });
  }

  return data.user;
}

/**
 * Connexion
 */
export async function connecter(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

/**
 * Déconnexion
 */
export async function deconnecter() {
  await supabase.auth.signOut();
}

/**
 * Récupérer l'utilisateur connecté
 */
export async function getUtilisateurConnecte() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

/**
 * Écouter les changements de session (connecté/déconnecté)
 */
export function ecouterSession(callback) {
  supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session?.user || null);
  });
}


// ════════════════════════════════════════════
// 2. PROFILS
// ════════════════════════════════════════════

/**
 * Récupérer tous les profils (le feed)
 * @param {object} filtres - { ville, sexe, age_min, age_max }
 */
export async function getProfiles(filtres = {}) {
  let query = supabase
    .from('utilisateurs')
    .select('*')
    .order('created_at', { ascending: false });

  if (filtres.ville) query = query.eq('ville', filtres.ville);
  if (filtres.sexe)  query = query.eq('sexe', filtres.sexe);
  if (filtres.age_min) query = query.gte('age', filtres.age_min);
  if (filtres.age_max) query = query.lte('age', filtres.age_max);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Récupérer un profil par ID
 */
export async function getProfil(userId) {
  const { data, error } = await supabase
    .from('utilisateurs')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Mettre à jour son propre profil
 */
export async function mettreAJourProfil(userId, modifications) {
  const { data, error } = await supabase
    .from('utilisateurs')
    .update(modifications)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Upload de photo de profil
 * @param {string} userId
 * @param {File} fichier - fichier image
 */
export async function uploadPhoto(userId, fichier) {
  const extension = fichier.name.split('.').pop();
  const chemin = `photos/${userId}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(chemin, fichier, { upsert: true });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('avatars').getPublicUrl(chemin);

  // Sauvegarder l'URL dans le profil
  await mettreAJourProfil(userId, { photo_url: data.publicUrl });
  return data.publicUrl;
}

/**
 * Mettre à jour le statut en ligne
 */
export async function setEnLigne(userId, enLigne) {
  await supabase
    .from('utilisateurs')
    .update({ en_ligne: enLigne })
    .eq('id', userId);
}


// ════════════════════════════════════════════
// 3. ABONNEMENTS
// ════════════════════════════════════════════

/**
 * Vérifier si l'utilisateur a un abonnement actif
 */
export async function verifierAbonnement(userId) {
  const maintenant = new Date().toISOString();

  const { data, error } = await supabase
    .from('abonnements')
    .select('*')
    .eq('user_id', userId)
    .eq('actif', true)
    .gte('fin', maintenant)
    .order('fin', { ascending: false })
    .limit(1)
    .single();

  if (error) return null;  // Pas d'abonnement actif
  return data;
}

/**
 * Créer un abonnement après paiement confirmé
 * @param {string} userId
 * @param {string} plan - 'basique' | 'standard' | 'premium'
 * @param {string} operateur - 'orange' | 'mtn' | 'wave' | 'moov'
 * @param {number} montant - montant payé en FCFA
 */
export async function creerAbonnement(userId, plan, operateur, montant) {
  const durees = { basique: 7, standard: 30, premium: 90 };
  const jours = durees[plan] || 30;

  const fin = new Date();
  fin.setDate(fin.getDate() + jours);

  const { data, error } = await supabase
    .from('abonnements')
    .insert({
      user_id: userId,
      plan,
      operateur,
      montant,
      fin: fin.toISOString(),
      actif: true
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Calculer le temps restant sur l'abonnement
 */
export function tempsRestant(abonnement) {
  if (!abonnement) return null;
  const fin = new Date(abonnement.fin);
  const maintenant = new Date();
  const diff = fin - maintenant;

  if (diff <= 0) return 'Expiré';

  const heures = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (heures >= 24) {
    const jours = Math.floor(heures / 24);
    return `${jours} jour${jours > 1 ? 's' : ''} restant${jours > 1 ? 's' : ''}`;
  }
  return `${heures}h ${minutes}min restant${heures > 0 ? 's' : ''}`;
}


// ════════════════════════════════════════════
// 4. DEMANDES DE CONTACT
// ════════════════════════════════════════════

/**
 * Envoyer une demande de contact
 * @param {string} envoyeurId
 * @param {string} receveurId
 * @param {string} message - message d'introduction
 */
export async function envoyerDemande(envoyeurId, receveurId, message) {
  // Vérifier que l'envoyeur a un abonnement actif
  const abo = await verifierAbonnement(envoyeurId);
  if (!abo) throw new Error('Abonnement requis pour envoyer des demandes');

  const { data, error } = await supabase
    .from('demandes')
    .insert({
      envoyeur_id: envoyeurId,
      receveur_id: receveurId,
      message,
      statut: 'en_attente'
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Tu as déjà envoyé une demande à cette personne');
    throw error;
  }
  return data;
}

/**
 * Récupérer les demandes reçues
 */
export async function getDemandesRecues(userId) {
  const { data, error } = await supabase
    .from('demandes')
    .select(`
      *,
      envoyeur:utilisateurs!demandes_envoyeur_id_fkey(prenom, age, ville, photo_url, en_ligne)
    `)
    .eq('receveur_id', userId)
    .eq('statut', 'en_attente')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Récupérer les demandes envoyées
 */
export async function getDemandesEnvoyees(userId) {
  const { data, error } = await supabase
    .from('demandes')
    .select(`
      *,
      receveur:utilisateurs!demandes_receveur_id_fkey(prenom, age, ville, photo_url)
    `)
    .eq('envoyeur_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Accepter ou refuser une demande
 * @param {string} demandeId
 * @param {string} statut - 'acceptee' | 'refusee'
 */
export async function repondreDemande(demandeId, statut) {
  const { data, error } = await supabase
    .from('demandes')
    .update({ statut })
    .eq('id', demandeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Écouter les nouvelles demandes en temps réel
 */
export function ecouterDemandes(userId, callback) {
  return supabase
    .channel('demandes_' + userId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'demandes',
      filter: `receveur_id=eq.${userId}`
    }, payload => callback(payload.new))
    .subscribe();
}


// ════════════════════════════════════════════
// 5. MESSAGES
// ════════════════════════════════════════════

/**
 * Envoyer un message dans une conversation
 */
export async function envoyerMessage(demandeId, auteurId, contenu) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ demande_id: demandeId, auteur_id: auteurId, contenu })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Récupérer les messages d'une conversation
 */
export async function getMessages(demandeId) {
  const { data, error } = await supabase
    .from('messages')
    .select(`*, auteur:utilisateurs!messages_auteur_id_fkey(prenom, photo_url)`)
    .eq('demande_id', demandeId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Écouter les nouveaux messages en temps réel
 */
export function ecouterMessages(demandeId, callback) {
  return supabase
    .channel('messages_' + demandeId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `demande_id=eq.${demandeId}`
    }, payload => callback(payload.new))
    .subscribe();
}


// ════════════════════════════════════════════
// 6. INTÉGRATION CINETPAY (Paiement Mobile Money)
// Docs : https://developer.cinetpay.com
// ════════════════════════════════════════════

/**
 * Initier un paiement CinetPay
 * IMPORTANT : Appelle cette fonction depuis ton serveur (pas côté client)
 * pour protéger ta clé secrète CinetPay
 */
export function initierPaiementCinetPay({ userId, plan, montant, telephone, operateur }) {
  // À appeler depuis une Edge Function Supabase ou un serveur Node.js
  const config = {
    apikey: 'TA_CLE_CINETPAY',         // ← depuis dashboard.cinetpay.com
    site_id: 'TON_SITE_ID',             // ← depuis dashboard.cinetpay.com
    transaction_id: `FLC_${userId}_${Date.now()}`,
    amount: montant,
    currency: 'XOF',
    description: `FinileCelibat - Abonnement ${plan}`,
    customer_phone_number: `+225${telephone}`,
    channels: getChannelCinetPay(operateur),
    notify_url: 'https://TON-SITE.vercel.app/api/cinetpay-webhook',
    return_url: 'https://TON-SITE.vercel.app/paiement-succes.html',
    cancel_url: 'https://TON-SITE.vercel.app/paiement.html',
  };
  return config;
}

function getChannelCinetPay(operateur) {
  const map = {
    orange: 'ORANGE_CI',
    mtn: 'MTN_CI',
    wave: 'WAVE_CI',
    moov: 'MOOV_CI'
  };
  return map[operateur] || 'ALL';
}


// ════════════════════════════════════════════
// EXEMPLE D'UTILISATION (dans tes pages HTML)
// ════════════════════════════════════════════
/*

// --- INSCRIPTION ---
import { inscrire } from './backend.js';

const user = await inscrire('konan@gmail.com', 'motdepasse123', {
  prenom: 'Konan',
  age: 25,
  sexe: 'homme',
  ville: 'Abidjan',
  telephone: '0700000000'
});

// --- CHARGER LE FEED ---
import { getProfiles, verifierAbonnement } from './backend.js';

const profils = await getProfiles({ ville: 'Abidjan' });
const abo = await verifierAbonnement(user.id);

// --- ENVOYER UNE DEMANDE ---
import { envoyerDemande } from './backend.js';

await envoyerDemande(monId, profilId, "Bonjour, j'ai vu ton profil...");

*/